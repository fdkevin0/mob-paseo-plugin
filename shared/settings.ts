import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One command the owner typed for a project, such as its tests or build. */
export const CheckSchema = z.object({
  name: z.string().min(1),
  /** Runs through the system shell in the agent's working directory. */
  command: z.string().min(1),
  timeoutSeconds: z.number().int().positive().default(600),
});

/** The agent that reviews finished work. Pick a different provider from the worker's. */
export const ReviewerSchema = z.object({
  /** `provider/model`, for example `claude/claude-sonnet-5`. */
  provider: z.string().min(1),
  modeId: z.string().optional(),
  /** Provider-native options, for example `{ "sandbox_mode": "read-only" }` for Codex. */
  options: z.record(z.string(), z.json()).optional(),
});

export const BlueprintNameSchema = z.enum(["standard", "quick", "manual"]);

export const ProjectSchema = z.object({
  /** Absolute path of the repository's main checkout. Worktrees of it match too. */
  path: z.string().min(1),
  /**
   * `standard`: checks, then a review. `quick`: checks only. `manual`: Mob runs nothing after
   * a turn; only the policy applies.
   */
  blueprint: BlueprintNameSchema.default("standard"),
  checks: z.array(CheckSchema).default([]),
  /** How many times a failing check goes back to the agent before Mob asks you. */
  checkRetries: z.number().int().min(0).max(10).default(2),
  /** How many review rounds may send findings back to the agent. */
  reviewRounds: z.number().int().min(0).max(5).default(1),
  reviewer: ReviewerSchema.nullable().default(null),
  /**
   * Shell commands Mob approves for you. An entry is an exact command, or a prefix ending in
   * `*`. Commands that chain, pipe, redirect, or substitute are never approved automatically.
   */
  allow: z.array(z.string().min(1)).default([]),
  /** Shell commands Mob declines for you, in the same format. Deny wins over allow. */
  deny: z.array(z.string().min(1)).default([]),
  /**
   * Provider-native options set on every new agent in the project, keyed by provider ID, for
   * example `{ "codex": { "sandbox_mode": "workspace-write" } }`.
   */
  providerOptions: z.record(z.string(), z.record(z.string(), z.json())).default({}),
});

export const MobSettingsSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
});

export type MobCheck = z.output<typeof CheckSchema>;
export type MobReviewer = z.output<typeof ReviewerSchema>;
export type MobProject = z.output<typeof ProjectSchema>;
export type MobSettings = z.output<typeof MobSettingsSchema>;

/**
 * Host-scoped and edited only by the owner in Settings. Checks and policy deliberately do not
 * live in the repository: an agent can edit files in its worktree, and must not be able to
 * widen its own policy or plant a command that Mob later runs.
 */
export const mobSettings = defineSettings({
  id: "projects",
  scope: "host",
  version: 1,
  schema: MobSettingsSchema,
});

/** Parses the draft and reports the first problem in words. */
export function parseSettingsDraft(text: string): { values?: MobSettings; error?: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { error: `Not valid JSON: ${(error as Error).message}` };
  }
  const parsed = MobSettingsSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `${issue?.path.join(".") || "settings"}: ${issue?.message ?? "invalid"}` };
  }
  return { values: parsed.data };
}

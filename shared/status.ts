import { z } from "zod";

export const BLUEPRINT_ROW_KIND = "mob-blueprint";
export const BLUEPRINT_ROW_VERSION = 1;

export const PhaseSchema = z.enum(["checking", "working", "reviewing", "ready", "attention"]);

export const CheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  /** Last lines of combined output, only kept for failures. */
  tail: z.string().optional(),
});

/** The card Mob keeps in a worker's timeline, one per blueprint cycle. */
export const BlueprintRowSchema = z.object({
  phase: PhaseSchema,
  summary: z.string(),
  checks: z.array(CheckResultSchema),
  checkFailures: z.number().int(),
  checkRetries: z.number().int(),
  review: z
    .object({
      round: z.number().int(),
      verdict: z.enum(["pending", "approve", "changes", "unknown"]),
      reviewerId: z.string().nullable(),
    })
    .nullable(),
});

export type Phase = z.output<typeof PhaseSchema>;
export type CheckResult = z.output<typeof CheckResultSchema>;
export type BlueprintRow = z.output<typeof BlueprintRowSchema>;

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { BlueprintNameSchema } from "./settings";
import { PhaseSchema } from "./status";

export const PLAN_ROW_KIND = "mob-plan";
export const PLAN_ROW_VERSION = 1;
export const MAX_PLAN_TASKS = 6;

/** What the manager agent sends to `mob_task_plan`. */
export const PlanInputSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("One line naming the whole plan."),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120).describe("One line naming this task."),
        instructions: z
          .string()
          .trim()
          .min(1)
          .max(8_000)
          .describe(
            "Everything the task's agent needs: the goal, the files or areas involved, and how to know it is done. It starts with no other context.",
          ),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("`provider/model` for this task's agent. Omit to use the project's default."),
        blueprint: BlueprintNameSchema.optional().describe(
          "`standard` (checks, then review), `quick` (checks only) or `manual` (none). Omit for the project's.",
        ),
      }),
    )
    .min(1)
    .max(MAX_PLAN_TASKS),
});

export type PlanInput = z.output<typeof PlanInputSchema>;

export const PlanStatusSchema = z.enum(["pending", "rejected", "starting", "running", "done", "expired"]);
export const TaskStateSchema = z.union([PhaseSchema, z.enum(["waiting", "starting", "failed"])]);

/** The plan card in the manager's timeline. */
export const PlanRowSchema = z.object({
  planId: z.string(),
  title: z.string(),
  status: PlanStatusSchema,
  tasks: z.array(
    z.object({
      title: z.string(),
      provider: z.string(),
      blueprint: BlueprintNameSchema,
      state: TaskStateSchema,
      branch: z.string().nullable(),
      agentId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export type PlanStatus = z.output<typeof PlanStatusSchema>;
export type TaskState = z.output<typeof TaskStateSchema>;
export type PlanRow = z.output<typeof PlanRowSchema>;

const PlanDecisionOutput = z.object({
  ok: z.boolean(),
  /** Why the decision did not apply, in words for the owner. */
  error: z.string().nullable(),
});

export const approvePlanRpc = defineRpc({
  name: "plan.approve",
  input: z.object({ planId: z.string().min(1) }),
  output: PlanDecisionOutput,
});

export const rejectPlanRpc = defineRpc({
  name: "plan.reject",
  input: z.object({ planId: z.string().min(1) }),
  output: PlanDecisionOutput,
});

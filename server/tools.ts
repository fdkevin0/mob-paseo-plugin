import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { z } from "zod";
import { MAX_PLAN_TASKS, PlanInputSchema } from "../shared/plan";
import type { MobProject } from "../shared/settings";
import type { Plans } from "./plans";

export const TASK_ROLE = "task";
export const REVIEWER_ROLE = "reviewer";
export const ROLE_LABEL = "mob/role";

/** Mob's tools for agents that manage work rather than do it. */
export function managerTools(
  plans: Plans,
  projectFor: (cwd: string) => Promise<MobProject | null>,
): AgentToolDefinition[] {
  const propose = defineAgentTool({
    name: "mob_task_plan",
    title: "Propose a plan",
    description: [
      `Propose splitting work into 1 to ${MAX_PLAN_TASKS} tasks that can run at the same time, each done by its own coding agent in its own git worktree and branch.`,
      "The owner sees the plan as a card and approves or declines it once; nothing starts before that.",
      "After approval, Mob runs each task's checks and review and tells you when every task has finished.",
      "Use it when the parts are independent. Write each task's instructions so an agent with no other context can finish it.",
      "Do not start the work yourself after proposing; wait for Mob's message.",
    ].join(" "),
    input: PlanInputSchema,
    async execute(input, { agent }) {
      const project = await projectFor(agent.cwd);
      if (!project || !project.plans) {
        return { isError: true, text: "Plans are not enabled for this repository in Mob's settings." };
      }
      try {
        const plan = await plans.propose(
          { id: agent.id, cwd: agent.cwd, provider: agent.provider },
          project,
          input,
        );
        return {
          text: `Proposed plan "${plan.title}" with ${plan.tasks.length} tasks. The owner approves or declines it in the card. End your turn now and wait; Mob will tell you the outcome.`,
          structuredContent: { planId: plan.id },
        };
      } catch (error) {
        return { isError: true, text: (error as Error).message };
      }
    },
  });

  const status = defineAgentTool({
    name: "mob_plan_status",
    title: "Plan status",
    description:
      "Show the plans you proposed and where each task is: waiting, starting, working, checking, reviewing, ready, attention (needs the owner) or failed.",
    input: z.object({}),
    async execute(_input, { agent }) {
      const rows = plans.status(agent.id);
      if (rows.length === 0) return { text: "You have not proposed any plan.", structuredContent: { plans: [] } };
      const text = rows
        .map((row) =>
          [
            `${row.title} (${row.status})`,
            ...row.tasks.map(
              (task) =>
                `- ${task.title}: ${task.state}${task.branch ? ` on ${task.branch}` : ""}${task.error ? ` (${task.error})` : ""}`,
            ),
          ].join("\n"),
        )
        .join("\n\n");
      return { text, structuredContent: { plans: rows } };
    },
  });

  return [propose, status];
}

/** Agents Mob started for a task or a review do not plan. */
export function mayManage(labels: Readonly<Record<string, string>>): boolean {
  const role = labels[ROLE_LABEL];
  return role !== TASK_ROLE && role !== REVIEWER_ROLE;
}

// Only Paseo's own tool server: another MCP server may not borrow the name.
const MOB_TOOL = /^(?:mcp__paseo__|paseo[./])?(?:mob_task_plan|mob_plan_status)$/;

/** Mob's own manager tools ask nothing of the owner: a plan still waits for the owner's approval. */
export function isMobTool(permissionName: string): boolean {
  return MOB_TOOL.test(permissionName);
}

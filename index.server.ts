import { randomUUID } from "node:crypto";
import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { mobSettings, type MobProject, type MobSettings } from "./shared/settings";
import { BLUEPRINT_ROW_KIND, BLUEPRINT_ROW_VERSION } from "./shared/status";
import { Blueprints, runsAfterTurn } from "./server/blueprint";
import { runChecks } from "./server/checks";
import { decideCommand, providerOptionsFor } from "./server/policy";
import { shellCommand } from "./server/permission";
import { projectFor } from "./server/repo";
import { Plans, planRow, slug } from "./server/plans";
import { isMobTool, managerTools, mayManage, REVIEWER_ROLE, ROLE_LABEL, TASK_ROLE } from "./server/tools";
import { PLAN_ROW_KIND, PLAN_ROW_VERSION, approvePlanRpc, rejectPlanRpc } from "./shared/plan";

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

function taskPrompt(plan: string, title: string, instructions: string): string {
  return [
    `You are doing one task of the plan "${plan}": ${title}.`,
    "You work in your own git worktree and branch; other agents do the other tasks in theirs.",
    "",
    instructions,
    "",
    "When you are done, commit your work on this branch. Do not push, open pull requests, or merge: the owner decides. Mob runs the project's checks and a review after you finish.",
  ].join("\n");
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(mobSettings);
  let current: MobSettings = { projects: [] };
  const load = async () => {
    const state = await settings.read();
    if (state.status === "ready") current = state.values;
    else console.error(`[mob] settings are invalid and were ignored: ${state.error}`);
  };
  const loaded = load();
  const stopWatching = settings.subscribe((state) => {
    if (state.status === "ready") current = state.values;
  });
  const project = async (cwd: string): Promise<MobProject | null> => {
    await loaded;
    return projectFor(current.projects, cwd);
  };

  // Late-bound: the Paseo API reaches plugins only through hook and handler contexts.
  let paseo: PluginHookContext["paseo"] | null = null;
  // Reviewers carry a one-time marker so only Mob's own reviewers get the reviewer options.
  const reviewerMarkers = new Map<string, Record<string, unknown>>();
  const api = () => {
    if (!paseo) throw new Error("Paseo API is not available yet");
    return paseo;
  };

  const plans = new Plans({
    start: async (plan, task, index) => {
      const branch = `mob/${slug(task.title)}-${plan.id.slice(0, 6)}${index}`;
      const workspace = await api().workspaces.create({
        title: task.title,
        source: {
          kind: "worktree",
          cwd: plan.cwd,
          action: "branch-off",
          branchName: branch,
          ...(plan.baseRef ? { refName: plan.baseRef } : {}),
        },
      });
      const agent = await workspace.agents.create({
        title: task.title,
        labels: { [ROLE_LABEL]: TASK_ROLE, "mob/plan": plan.id },
        config: { provider: task.provider },
        prompt: taskPrompt(plan.title, task.title, task.instructions),
      });
      return { agentId: agent.id, branch };
    },
    show: async (plan) => {
      await api()
        .agents.ref(plan.managerId)
        .timeline.append({
          type: "plugin",
          id: `plan-${plan.id}`,
          kind: PLAN_ROW_KIND,
          version: PLAN_ROW_VERSION,
          data: planRow(plan),
        });
    },
    tell: async (managerId, text) => {
      await api().agents.ref(managerId).send(text);
    },
    newId: () => randomUUID(),
    log: (message) => console.error(`[mob] ${message}`),
  });
  const tools = managerTools(plans, project);

  server.handle(approvePlanRpc, async ({ planId }, context) => {
    paseo = context.paseo;
    return plans.approve(planId);
  });
  server.handle(rejectPlanRpc, async ({ planId }, context) => {
    paseo = context.paseo;
    return plans.reject(planId);
  });

  const blueprints = new Blueprints({
    runChecks: (checks, cwd) => runChecks(checks, cwd),
    send: async (workerId, text) => {
      await api().agents.ref(workerId).send(text);
    },
    review: async (worker, reviewer, prompt, onStarted) => {
      const marker = `mob-reviewer:${randomUUID()}`;
      reviewerMarkers.set(marker, reviewer.options ?? {});
      const agent = await api().agents.create({
        cwd: worker.cwd,
        parent: worker.id,
        title: "Mob review",
        labels: { [ROLE_LABEL]: REVIEWER_ROLE },
        config: {
          provider: reviewer.provider,
          ...(reviewer.modeId ? { modeId: reviewer.modeId } : {}),
          ...(reviewer.options ? { options: reviewer.options } : {}),
          systemPrompt: `You are a read-only reviewer. Never change files. (${marker})`,
        },
        prompt,
      }).finally(() => reviewerMarkers.delete(marker));
      onStarted(agent.id);
      const result = await agent.waitForFinish(REVIEW_TIMEOUT_MS);
      return result.status === "idle" ? (result.lastMessage ?? null) : null;
    },
    report: async (workerId, cycle, row) => {
      await api()
        .agents.ref(workerId)
        .timeline.append({
          type: "plugin",
          id: `blueprint-${cycle}`,
          kind: BLUEPRINT_ROW_KIND,
          version: BLUEPRINT_ROW_VERSION,
          data: row,
        });
      await plans.onPhase(workerId, row.phase);
    },
    log: (message) => console.error(`[mob] ${message}`),
  });

  // Plans: managers (any agent Mob did not start for a task or review) get Mob's tools.
  server.addHook("agent.open.before", async ({ request }, context) => {
    paseo = context.paseo;
    if (request.purpose !== "interactive" || !mayManage(request.labels)) return;
    const found = await project(request.cwd);
    if (!found?.plans) return;
    return { ...request, tools: [...request.tools, ...tools] };
  });

  // Policy, hard part: the owner's provider-native options on every new agent in a project.
  server.addHook("agent.create.before", async ({ request }) => {
    const marker = [...reviewerMarkers.keys()].find((key) =>
      request.config.systemPrompt?.includes(key),
    );
    const reviewerOptions = marker ? reviewerMarkers.get(marker) : undefined;
    const found = await project(request.config.cwd);
    const options = found ? providerOptionsFor(found, request.config.provider) : null;
    if (!options && !reviewerOptions) return request;
    return {
      ...request,
      config: {
        ...request.config,
        providerOptions: {
          ...request.config.providerOptions,
          ...options,
          // A reviewer's own options win, so a read-only sandbox is not widened by the project's.
          ...reviewerOptions,
        },
      },
    };
  });

  // Policy, soft part: answer shell permissions the owner allowed or denied.
  server.addHook("agent.permission.before", async ({ agent, request }, context) => {
    paseo = context.paseo;
    if (isMobTool(request.name)) {
      await context.paseo.agents.ref(agent.id).respondToPermission({
        requestId: request.id,
        response: { behavior: "allow" },
      });
      return;
    }
    const command = shellCommand(request);
    if (command === null) return;
    const found = await project(agent.cwd);
    if (!found) return;
    const decision = decideCommand(found, command);
    if (decision === null) return;
    await context.paseo.agents.ref(agent.id).respondToPermission({
      requestId: request.id,
      response:
        decision === "allow"
          ? { behavior: "allow" }
          : { behavior: "deny", message: "This command is denied by the project's Mob policy." },
    });
  });

  // Blueprint: checks and review after each completed turn of a top-level agent.
  server.addHook("agent.turn.after", async ({ agent, outcome }, context) => {
    paseo = context.paseo;
    if (outcome.kind !== "completed") return;
    if (agent.parentAgentId !== null || blueprints.isReviewer(agent.id)) return;
    // A manager coordinates; its tasks run their own blueprints.
    if (plans.isManager(agent.id)) return;
    const found = await project(agent.cwd);
    if (!found) return;
    const task = plans.taskOf(agent.id)?.task;
    const effective = task ? { ...found, blueprint: task.blueprint } : found;
    if (task && !runsAfterTurn(effective)) {
      // Nothing to check or review: the task is ready once its agent finishes a turn.
      await plans.onPhase(agent.id, "ready");
      return;
    }
    await blueprints.afterTurn({ id: agent.id, cwd: agent.cwd }, effective);
  });

  server.addHook("agent.archive.after", async ({ agent }, context) => {
    paseo = context.paseo;
    blueprints.forget(agent.id);
    plans.forget(agent.id);
  });

  return () => {
    stopWatching();
  };
}

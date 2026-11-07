import { randomUUID } from "node:crypto";
import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { mobSettings, type MobProject, type MobSettings } from "./shared/settings";
import { BLUEPRINT_ROW_KIND, BLUEPRINT_ROW_VERSION } from "./shared/status";
import { Blueprints } from "./server/blueprint";
import { runChecks } from "./server/checks";
import { decideCommand, providerOptionsFor } from "./server/policy";
import { shellCommand } from "./server/permission";
import { projectFor } from "./server/repo";

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

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
        labels: { "mob/role": "reviewer" },
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
    },
    log: (message) => console.error(`[mob] ${message}`),
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
    const found = await project(agent.cwd);
    if (!found) return;
    await blueprints.afterTurn({ id: agent.id, cwd: agent.cwd }, found);
  });

  server.addHook("agent.archive.after", async ({ agent }, context) => {
    paseo = context.paseo;
    blueprints.forget(agent.id);
  });

  return () => {
    stopWatching();
  };
}

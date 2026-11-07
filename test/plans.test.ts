import { describe, expect, it } from "vitest";
import { Plans, slug, type Plan, type PlanEffects } from "../server/plans";
import { isMobTool, mayManage } from "../server/tools";
import { PlanInputSchema, type PlanInput } from "../shared/plan";
import { project } from "./helpers";

const manager = { id: "m1", cwd: "/repo", provider: "claude" };

function harness(options: { failStart?: (title: string) => boolean } = {}) {
  const shown: Plan[] = [];
  const told: string[] = [];
  const started: string[] = [];
  let ids = 0;
  const effects: PlanEffects = {
    start: async (_plan, task, index) => {
      if (options.failStart?.(task.title)) throw new Error("worktree exists");
      started.push(task.title);
      return { agentId: `a${index}`, branch: `mob/${slug(task.title)}-${index}` };
    },
    show: async (plan) => {
      shown.push(structuredClone(plan));
    },
    tell: async (_id, text) => {
      told.push(text);
    },
    newId: () => `plan${++ids}`,
    log: () => {},
  };
  return { plans: new Plans(effects), shown, told, started, last: () => shown.at(-1)! };
}

const input: PlanInput = PlanInputSchema.parse({
  title: "Split the parser work",
  tasks: [
    { title: "Lexer", instructions: "Rewrite the lexer." },
    { title: "Errors", instructions: "Better errors.", provider: "codex/gpt-5.5", blueprint: "quick" },
  ],
});

describe("propose", () => {
  it("fills provider and blueprint from the project, then the manager", async () => {
    const h = harness();
    const plan = await h.plans.propose(manager, project({ blueprint: "standard" }), input);
    expect(plan.status).toBe("pending");
    expect(plan.tasks.map((t) => [t.provider, t.blueprint, t.state])).toEqual([
      ["claude", "standard", "waiting"],
      ["codex/gpt-5.5", "quick", "waiting"],
    ]);
    const withDefault = await harness().plans.propose(manager, project({ taskProvider: "pi/x" }), input);
    expect(withDefault.tasks[0]!.provider).toBe("pi/x");
    expect(h.started).toEqual([]);
    expect(h.plans.isManager("m1")).toBe(true);
  });

  it("refuses duplicate task titles", async () => {
    const h = harness();
    const dup = PlanInputSchema.parse({
      title: "x",
      tasks: [
        { title: "A", instructions: "1" },
        { title: "a", instructions: "2" },
      ],
    });
    await expect(h.plans.propose(manager, project(), dup)).rejects.toThrow(/both titled/);
  });

  it("limits a plan to six tasks", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ title: `t${i}`, instructions: "x" }));
    expect(PlanInputSchema.safeParse({ title: "x", tasks }).success).toBe(false);
  });

  it("replaces a pending plan from the same manager", async () => {
    const h = harness();
    const first = await h.plans.propose(manager, project(), input);
    await h.plans.propose(manager, project(), input);
    expect(h.plans.get(first.id)!.status).toBe("expired");
    expect((await h.plans.approve(first.id)).ok).toBe(false);
  });
});

describe("approve", () => {
  it("starts every task once, then tells the manager", async () => {
    const h = harness();
    const plan = await h.plans.propose(manager, project(), input);
    expect(await h.plans.approve(plan.id)).toEqual({ ok: true, error: null });
    expect(h.started).toEqual(["Lexer", "Errors"]);
    expect(h.last().status).toBe("running");
    expect(h.last().tasks.map((t) => [t.state, t.agentId])).toEqual([
      ["working", "a0"],
      ["working", "a1"],
    ]);
    expect(h.told[0]).toContain("approved");
    expect(h.told[0]).toContain("mob/lexer-0");
    expect(h.plans.taskOf("a1")?.task.title).toBe("Errors");
    expect((await h.plans.approve(plan.id)).error).toMatch(/already running/);
    expect(h.started).toHaveLength(2);
  });

  it("keeps going when one task cannot start", async () => {
    const h = harness({ failStart: (title) => title === "Lexer" });
    const plan = await h.plans.propose(manager, project(), input);
    expect((await h.plans.approve(plan.id)).ok).toBe(true);
    expect(h.last().tasks.map((t) => t.state)).toEqual(["failed", "working"]);
    expect(h.last().tasks[0]!.error).toBe("worktree exists");
  });

  it("reports when nothing could start", async () => {
    const h = harness({ failStart: () => true });
    const plan = await h.plans.propose(manager, project(), input);
    expect(await h.plans.approve(plan.id)).toEqual({ ok: false, error: "No task could start." });
    expect(h.last().status).toBe("done");
  });

  it("explains a plan it no longer has", async () => {
    expect((await harness().plans.approve("gone")).error).toMatch(/restarted/);
  });
});

describe("reject", () => {
  it("starts nothing and tells the manager", async () => {
    const h = harness();
    const plan = await h.plans.propose(manager, project(), input);
    expect((await h.plans.reject(plan.id)).ok).toBe(true);
    expect(h.last().status).toBe("rejected");
    expect(h.started).toEqual([]);
    expect(h.told[0]).toContain("declined");
    expect((await h.plans.approve(plan.id)).ok).toBe(false);
  });
});

describe("progress", () => {
  it("tracks phases and tells the manager once when all tasks finish", async () => {
    const h = harness();
    const plan = await h.plans.propose(manager, project(), input);
    await h.plans.approve(plan.id);
    h.told.length = 0;

    await h.plans.onPhase("a0", "checking");
    await h.plans.onPhase("a0", "ready");
    expect(h.last().status).toBe("running");
    expect(h.told).toEqual([]);

    await h.plans.onPhase("a1", "attention");
    expect(h.last().status).toBe("done");
    expect(h.told).toHaveLength(1);
    expect(h.told[0]).toContain("Lexer on `mob/lexer-0`: ready");
    expect(h.told[0]).toContain("Errors on `mob/errors-1`: needs the owner");
    expect(h.told[0]).toContain("Do not push");

    // A later cycle on a finished task updates the card but does not repeat the summary.
    await h.plans.onPhase("a1", "checking");
    await h.plans.onPhase("a1", "ready");
    expect(h.told).toHaveLength(1);
    expect(h.plans.status("m1")[0]!.tasks[1]!.state).toBe("ready");
  });

  it("ignores agents that are not plan tasks", async () => {
    const h = harness();
    await h.plans.onPhase("stranger", "ready");
    expect(h.shown).toEqual([]);
  });
});

it("makes branch-safe slugs", () => {
  expect(slug("Fix the Parser: errors & warnings!")).toBe("fix-the-parser-errors-warnings");
  expect(slug("中文")).toBe("task");
  expect(slug("a".repeat(60))).toHaveLength(40);
});

it("keeps Mob's own task and reviewer agents from planning", () => {
  expect(mayManage({})).toBe(true);
  expect(mayManage({ "mob/role": "manager" })).toBe(true);
  expect(mayManage({ "mob/role": "task" })).toBe(false);
  expect(mayManage({ "mob/role": "reviewer" })).toBe(false);
});

it("recognises Mob's tools in permission requests", () => {
  expect(isMobTool("mcp__paseo__mob_task_plan")).toBe(true);
  expect(isMobTool("paseo.mob_plan_status")).toBe(true);
  expect(isMobTool("mob_task_plan")).toBe(true);
  expect(isMobTool("mcp__evil__not_mob_task_plan")).toBe(false);
  expect(isMobTool("mcp__evil__mob_task_plan")).toBe(false);
  expect(isMobTool("Bash")).toBe(false);
});

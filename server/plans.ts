import type { MobProject } from "../shared/settings";
import type { PlanInput, PlanRow, PlanStatus, TaskState } from "../shared/plan";
import type { Phase } from "../shared/status";

export interface PlanTask {
  title: string;
  instructions: string;
  provider: string;
  blueprint: MobProject["blueprint"];
  branch: string | null;
  agentId: string | null;
  state: TaskState;
  error: string | null;
}

export interface Plan {
  id: string;
  managerId: string;
  /** The manager's working directory; task worktrees branch off this checkout. */
  cwd: string;
  title: string;
  status: PlanStatus;
  baseRef: string | null;
  tasks: PlanTask[];
}

export interface Manager {
  id: string;
  cwd: string;
  provider: string;
}

export interface StartedTask {
  agentId: string;
  branch: string;
}

/** What plans do to the outside world. */
export interface PlanEffects {
  /** Creates the task's worktree and starts its agent with the instructions. */
  start(plan: Plan, task: PlanTask, index: number): Promise<StartedTask>;
  /** Shows or replaces the plan card in the manager's timeline. */
  show(plan: Plan): Promise<void>;
  /** Tells the manager agent something, as a new prompt in its conversation. */
  tell(managerId: string, text: string): Promise<void>;
  newId(): string;
  log(message: string): void;
}

const FINISHED: ReadonlySet<TaskState> = new Set(["ready", "attention", "failed"]);

export function slug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "task";
}

export function planRow(plan: Plan): PlanRow {
  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    tasks: plan.tasks.map((task) => ({
      title: task.title,
      provider: task.provider,
      blueprint: task.blueprint,
      state: task.state,
      branch: task.branch,
      agentId: task.agentId,
      error: task.error,
    })),
  };
}

function summary(plan: Plan): string {
  const lines = plan.tasks.map((task) => {
    const where = task.branch ? ` on \`${task.branch}\`` : "";
    const state =
      task.state === "ready"
        ? "ready for the owner to review"
        : task.state === "attention"
          ? "needs the owner"
          : `failed to start: ${task.error ?? "unknown error"}`;
    return `- ${task.title}${where}: ${state}`;
  });
  return [
    `Mob: every task of the plan "${plan.title}" has finished.`,
    ...lines,
    "",
    "Summarize this for the owner. Do not push, open pull requests, or merge; the owner decides.",
  ].join("\n");
}

export type Decision = { ok: true; error: null } | { ok: false; error: string };

/**
 * Plans proposed by manager agents. A plan waits for the owner's single approval, then every
 * task starts in its own worktree. Each task's agent then runs its blueprint like any other;
 * when all tasks have finished, the manager hears once.
 */
export class Plans {
  private readonly plans = new Map<string, Plan>();
  private readonly byAgent = new Map<string, { plan: Plan; task: PlanTask }>();

  constructor(private readonly effects: PlanEffects) {}

  get(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /** Whether the agent has proposed a plan; managers do not run the blueprint themselves. */
  isManager(agentId: string): boolean {
    for (const plan of this.plans.values()) if (plan.managerId === agentId) return true;
    return false;
  }

  /** The plan task an agent works on, if Mob started it. */
  taskOf(agentId: string): { plan: Plan; task: PlanTask } | undefined {
    return this.byAgent.get(agentId);
  }

  async propose(manager: Manager, project: MobProject, input: PlanInput): Promise<Plan> {
    const titles = new Set<string>();
    for (const task of input.tasks) {
      const key = task.title.toLowerCase();
      if (titles.has(key)) throw new Error(`Two tasks are both titled "${task.title}".`);
      titles.add(key);
    }
    const plan: Plan = {
      id: this.effects.newId(),
      managerId: manager.id,
      cwd: manager.cwd,
      title: input.title,
      status: "pending",
      baseRef: project.baseRef,
      tasks: input.tasks.map((task) => ({
        title: task.title,
        instructions: task.instructions,
        provider: task.provider ?? project.taskProvider ?? manager.provider,
        blueprint: task.blueprint ?? project.blueprint,
        branch: null,
        agentId: null,
        state: "waiting",
        error: null,
      })),
    };
    // A newer proposal from the same manager replaces one still waiting for the owner.
    for (const other of this.plans.values()) {
      if (other.managerId === manager.id && other.status === "pending") {
        other.status = "expired";
        await this.show(other);
      }
    }
    this.plans.set(plan.id, plan);
    await this.show(plan);
    return plan;
  }

  async approve(planId: string): Promise<Decision> {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { ok: false, error: "Mob no longer has this plan (the daemon or plugin restarted). Ask the agent to propose it again." };
    }
    if (plan.status !== "pending") return { ok: false, error: `This plan is already ${plan.status}.` };
    plan.status = "starting";
    for (const task of plan.tasks) task.state = "starting";
    await this.show(plan);

    let started = 0;
    for (const [index, task] of plan.tasks.entries()) {
      try {
        const result = await this.effects.start(plan, task, index);
        task.agentId = result.agentId;
        task.branch = result.branch;
        task.state = "working";
        this.byAgent.set(result.agentId, { plan, task });
        started += 1;
      } catch (error) {
        task.state = "failed";
        task.error = (error as Error).message;
        this.effects.log(`plan ${plan.id}: could not start "${task.title}": ${task.error}`);
      }
      await this.show(plan);
    }

    plan.status = started === 0 ? "done" : "running";
    await this.show(plan);
    const failed = plan.tasks.filter((task) => task.state === "failed");
    await this.tellQuietly(
      plan.managerId,
      [
        `Mob: the owner approved the plan "${plan.title}". ${started} of ${plan.tasks.length} tasks started, each in its own worktree:`,
        ...plan.tasks.map(
          (task) =>
            `- ${task.title}: ${task.state === "failed" ? `failed to start (${task.error})` : `\`${task.branch}\``}`,
        ),
        "",
        failed.length === plan.tasks.length
          ? "Nothing is running. Tell the owner what failed."
          : "Do not do these tasks yourself. Mob checks and reviews each one and tells you when all have finished; `mob_plan_status` shows progress.",
      ].join("\n"),
    );
    if (started === 0) return { ok: false, error: "No task could start." };
    return { ok: true, error: null };
  }

  async reject(planId: string): Promise<Decision> {
    const plan = this.plans.get(planId);
    if (!plan) return { ok: false, error: "Mob no longer has this plan." };
    if (plan.status !== "pending") return { ok: false, error: `This plan is already ${plan.status}.` };
    plan.status = "rejected";
    await this.show(plan);
    await this.tellQuietly(
      plan.managerId,
      `Mob: the owner declined the plan "${plan.title}". Nothing was started. Ask the owner what to change before proposing another.`,
    );
    return { ok: true, error: null };
  }

  /** Call when a task's blueprint reports a phase. */
  async onPhase(agentId: string, phase: Phase): Promise<void> {
    const entry = this.byAgent.get(agentId);
    if (!entry) return;
    const { plan, task } = entry;
    if (task.state === phase) return;
    task.state = phase;
    const allFinished = plan.tasks.every((other) => FINISHED.has(other.state));
    const wasRunning = plan.status === "running";
    if (allFinished) plan.status = "done";
    await this.show(plan);
    if (allFinished && wasRunning) await this.tellQuietly(plan.managerId, summary(plan));
  }

  /** Call when a task's agent is archived. */
  forget(agentId: string): void {
    this.byAgent.delete(agentId);
  }

  /** The manager's view, for `mob_plan_status`. */
  status(managerId: string): PlanRow[] {
    return [...this.plans.values()]
      .filter((plan) => plan.managerId === managerId)
      .map(planRow);
  }

  private async show(plan: Plan): Promise<void> {
    try {
      await this.effects.show(plan);
    } catch (error) {
      this.effects.log(`could not show plan ${plan.id}: ${(error as Error).message}`);
    }
  }

  private async tellQuietly(managerId: string, text: string): Promise<void> {
    try {
      await this.effects.tell(managerId, text);
    } catch (error) {
      this.effects.log(`could not tell manager ${managerId}: ${(error as Error).message}`);
    }
  }
}

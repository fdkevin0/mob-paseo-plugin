import type { MobCheck, MobProject, MobReviewer } from "../shared/settings";
import type { BlueprintRow, CheckResult, Phase } from "../shared/status";
import { checkFeedback, parseVerdict, reviewFeedback, reviewPrompt, type Verdict } from "./review";

export interface WorkerRef {
  id: string;
  cwd: string;
}

/** Everything the blueprint does to the outside world, so the state machine stays testable. */
export interface BlueprintEffects {
  runChecks(checks: readonly MobCheck[], cwd: string): Promise<CheckResult[]>;
  /** Sends a follow-up prompt into the worker's conversation. */
  send(workerId: string, text: string): Promise<void>;
  /** Starts a reviewer for the worker and resolves with its reply, or null when it did not finish. */
  review(
    worker: WorkerRef,
    reviewer: MobReviewer,
    prompt: string,
    onStarted: (reviewerId: string) => void,
  ): Promise<string | null>;
  /** Shows the cycle's status card in the worker's timeline. */
  report(workerId: string, cycle: number, row: BlueprintRow): Promise<void>;
  log(message: string): void;
}

interface WorkerState {
  cycle: number;
  phase: Phase;
  checkFailures: number;
  reviews: number;
  checks: CheckResult[];
  reviewerId: string | null;
  verdict: Verdict | "pending" | null;
}

const BUSY: ReadonlySet<Phase> = new Set(["checking", "reviewing"]);
const DONE: ReadonlySet<Phase> = new Set(["ready", "attention"]);

export function runsAfterTurn(project: MobProject): boolean {
  if (project.blueprint === "manual") return false;
  return project.checks.length > 0 || reviewerFor(project) !== null;
}

function reviewerFor(project: MobProject): MobReviewer | null {
  if (project.blueprint !== "standard" || project.reviewRounds === 0) return null;
  return project.reviewer;
}

/**
 * Mob's blueprint for one host: after a worker's turn completes, run the project's checks;
 * send failures back up to `checkRetries` times; then have another agent review, sending its
 * findings back up to `reviewRounds` times. The result is either `ready` or `attention`
 * (the owner decides). Mob itself never pushes or merges.
 */
export class Blueprints {
  private readonly workers = new Map<string, WorkerState>();
  private readonly reviewers = new Set<string>();

  constructor(private readonly effects: BlueprintEffects) {}

  isReviewer(agentId: string): boolean {
    return this.reviewers.has(agentId);
  }

  state(workerId: string): Readonly<WorkerState> | undefined {
    return this.workers.get(workerId);
  }

  forget(agentId: string): void {
    this.workers.delete(agentId);
    this.reviewers.delete(agentId);
  }

  /** Call when a worker's turn completed successfully. */
  async afterTurn(worker: WorkerRef, project: MobProject): Promise<void> {
    if (this.reviewers.has(worker.id) || !runsAfterTurn(project)) return;
    const previous = this.workers.get(worker.id);
    if (previous && BUSY.has(previous.phase)) return;

    const state: WorkerState =
      previous && !DONE.has(previous.phase)
        ? previous
        : {
            cycle: (previous?.cycle ?? 0) + 1,
            phase: "checking",
            checkFailures: 0,
            reviews: 0,
            checks: [],
            reviewerId: null,
            verdict: null,
          };
    this.workers.set(worker.id, state);

    state.phase = "checking";
    state.checks = [];
    await this.report(worker.id, state, project, "Running the project's checks.");

    state.checks = await this.effects.runChecks(project.checks, worker.cwd);
    const failed = state.checks.find((check) => !check.ok);
    if (failed) {
      if (state.checkFailures < project.checkRetries) {
        state.checkFailures += 1;
        state.phase = "working";
        await this.report(worker.id, state, project, `\`${failed.name}\` failed; sent back to the agent.`);
        await this.effects.send(
          worker.id,
          checkFeedback(failed, state.checkFailures, project.checkRetries),
        );
        return;
      }
      state.phase = "attention";
      await this.report(
        worker.id,
        state,
        project,
        `\`${failed.name}\` still fails after ${project.checkRetries} retries. Needs you.`,
      );
      return;
    }

    const reviewer = reviewerFor(project);
    if (!reviewer) {
      state.phase = "ready";
      await this.report(worker.id, state, project, "Checks passed. Ready to review.");
      return;
    }
    if (state.reviews > project.reviewRounds) {
      state.phase = "attention";
      await this.report(
        worker.id,
        state,
        project,
        `Checks pass, but the review used all ${project.reviewRounds} rounds of changes. Needs you.`,
      );
      return;
    }

    state.reviews += 1;
    state.phase = "reviewing";
    state.verdict = "pending";
    state.reviewerId = null;
    await this.report(worker.id, state, project, "Checks passed. Another agent is reviewing.");

    let reply: string | null;
    try {
      reply = await this.effects.review(worker, reviewer, reviewPrompt(state.reviews, state.checks), (id) => {
        state.reviewerId = id;
        this.reviewers.add(id);
      });
    } catch (error) {
      this.effects.log(`review failed for ${worker.id}: ${(error as Error).message}`);
      reply = null;
    }
    const verdict = parseVerdict(reply);
    state.verdict = verdict;

    if (verdict === "approve") {
      state.phase = "ready";
      await this.report(worker.id, state, project, "Checks passed and the review approved. Ready to review.");
      return;
    }
    // Findings go back to the agent at most `reviewRounds` times; the review after the last
    // round of rework is final.
    if (verdict === "changes" && reply && state.reviews <= project.reviewRounds) {
      state.phase = "working";
      await this.report(worker.id, state, project, "The reviewer asked for changes; sent back to the agent.");
      await this.effects.send(worker.id, reviewFeedback(reply, state.reviews));
      return;
    }
    state.phase = "attention";
    await this.report(
      worker.id,
      state,
      project,
      verdict === "changes"
        ? "The reviewer still asks for changes. Needs you."
        : "The review did not finish with a verdict. Needs you.",
    );
  }

  private async report(
    workerId: string,
    state: WorkerState,
    project: MobProject,
    summary: string,
  ): Promise<void> {
    const row: BlueprintRow = {
      phase: state.phase,
      summary,
      checks: state.checks,
      checkFailures: state.checkFailures,
      checkRetries: project.checkRetries,
      review:
        state.reviews === 0
          ? null
          : {
              round: state.reviews,
              verdict: state.verdict ?? "pending",
              reviewerId: state.reviewerId,
            },
    };
    try {
      await this.effects.report(workerId, state.cycle, row);
    } catch (error) {
      this.effects.log(`could not report on ${workerId}: ${(error as Error).message}`);
    }
  }
}

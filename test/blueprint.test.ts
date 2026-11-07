import { describe, expect, it } from "vitest";
import { Blueprints, runsAfterTurn, type BlueprintEffects } from "../server/blueprint";
import type { BlueprintRow, CheckResult } from "../shared/status";
import { project } from "./helpers";

const worker = { id: "w1", cwd: "/repo" };
const pass: CheckResult = { name: "tests", ok: true, exitCode: 0 };
const fail: CheckResult = { name: "tests", ok: false, exitCode: 1, tail: "boom" };

function harness(checks: CheckResult[][], replies: (string | null)[] = []) {
  const sent: string[] = [];
  const rows: { cycle: number; row: BlueprintRow }[] = [];
  const reviews: string[] = [];
  let reviewer = 0;
  const effects: BlueprintEffects = {
    runChecks: async () => checks.shift() ?? [pass],
    send: async (_id, text) => {
      sent.push(text);
    },
    review: async (_worker, _reviewer, prompt, onStarted) => {
      reviews.push(prompt);
      onStarted(`r${++reviewer}`);
      return replies.shift() ?? null;
    },
    report: async (_id, cycle, row) => {
      rows.push({ cycle, row: structuredClone(row) });
    },
    log: () => {},
  };
  const blueprints = new Blueprints(effects);
  const last = () => rows.at(-1)!.row;
  return { blueprints, sent, rows, reviews, last };
}

const checksOnly = project({ blueprint: "quick", checks: [{ name: "tests", command: "x" }] });
const reviewed = project({
  checks: [{ name: "tests", command: "x" }],
  reviewer: { provider: "claude/claude-sonnet-5" },
});

describe("runsAfterTurn", () => {
  it("needs checks or a reviewer, and not manual", () => {
    expect(runsAfterTurn(project())).toBe(false);
    expect(runsAfterTurn(checksOnly)).toBe(true);
    expect(runsAfterTurn(project({ reviewer: { provider: "c" } }))).toBe(true);
    expect(runsAfterTurn(project({ blueprint: "quick", reviewer: { provider: "c" } }))).toBe(false);
    expect(runsAfterTurn(project({ blueprint: "manual", checks: [{ name: "t", command: "x" }] }))).toBe(
      false,
    );
  });
});

describe("checks", () => {
  it("is ready when checks pass", async () => {
    const h = harness([[pass]]);
    await h.blueprints.afterTurn(worker, checksOnly);
    expect(h.rows.map((r) => r.row.phase)).toEqual(["checking", "ready"]);
    expect(h.sent).toEqual([]);
  });

  it("sends failures back until retries run out, then asks the owner", async () => {
    const h = harness([[fail], [fail], [fail]]);
    await h.blueprints.afterTurn(worker, checksOnly);
    expect(h.last().phase).toBe("working");
    expect(h.sent[0]).toContain("attempt 1 of 2");
    await h.blueprints.afterTurn(worker, checksOnly);
    expect(h.sent[1]).toContain("attempt 2 of 2");
    await h.blueprints.afterTurn(worker, checksOnly);
    expect(h.last().phase).toBe("attention");
    expect(h.sent).toHaveLength(2);
    expect(new Set(h.rows.map((r) => r.cycle))).toEqual(new Set([1]));
  });

  it("starts a new cycle after a finished one", async () => {
    const h = harness([[pass], [fail]]);
    await h.blueprints.afterTurn(worker, checksOnly);
    await h.blueprints.afterTurn(worker, checksOnly);
    expect(h.rows.at(-1)).toMatchObject({ cycle: 2, row: { phase: "working", checkFailures: 1 } });
  });

  it("ignores a turn while it is already checking", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness([]);
    const slow = new Blueprints({
      runChecks: async () => {
        await gate;
        return [pass];
      },
      send: async () => {},
      review: async () => null,
      report: async (_id, _cycle, row) => {
        h.rows.push({ cycle: 0, row: structuredClone(row) });
      },
      log: () => {},
    });
    const first = slow.afterTurn(worker, checksOnly);
    await slow.afterTurn(worker, checksOnly);
    release();
    await first;
    expect(h.rows.map((r) => r.row.phase)).toEqual(["checking", "ready"]);
  });
});

describe("review", () => {
  it("is ready when the reviewer approves", async () => {
    const h = harness([[pass]], ["fine\nVERDICT: APPROVE"]);
    await h.blueprints.afterTurn(worker, reviewed);
    expect(h.rows.map((r) => r.row.phase)).toEqual(["checking", "reviewing", "ready"]);
    expect(h.last().review).toEqual({ round: 1, verdict: "approve", reviewerId: "r1" });
    expect(h.blueprints.isReviewer("r1")).toBe(true);
  });

  it("sends findings back once, then the next review is final", async () => {
    const h = harness([[pass], [pass]], ["- fix a\nVERDICT: CHANGES", "- still\nVERDICT: CHANGES"]);
    await h.blueprints.afterTurn(worker, reviewed);
    expect(h.last().phase).toBe("working");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("- fix a");
    expect(h.sent[0]).not.toContain("VERDICT");
    await h.blueprints.afterTurn(worker, reviewed);
    expect(h.last()).toMatchObject({ phase: "attention", review: { round: 2, verdict: "changes" } });
    expect(h.sent).toHaveLength(1);
    expect(h.reviews[1]).toContain("round 2");
  });

  it("asks the owner when the review has no verdict", async () => {
    const h = harness([[pass]], [null]);
    await h.blueprints.afterTurn(worker, reviewed);
    expect(h.last()).toMatchObject({ phase: "attention", review: { verdict: "unknown" } });
  });

  it("does not review when checks fail", async () => {
    const h = harness([[fail]]);
    await h.blueprints.afterTurn(worker, reviewed);
    expect(h.reviews).toEqual([]);
    expect(h.last().phase).toBe("working");
  });

  it("skips reviewers' own turns", async () => {
    const h = harness([[pass], [pass]], ["VERDICT: APPROVE"]);
    await h.blueprints.afterTurn(worker, reviewed);
    const before = h.rows.length;
    await h.blueprints.afterTurn({ id: "r1", cwd: "/repo" }, reviewed);
    expect(h.rows.length).toBe(before);
  });

  it("treats a thrown review as no verdict", async () => {
    const h = harness([[pass]]);
    const broken = new Blueprints({
      runChecks: async () => [pass],
      send: async () => {},
      review: async () => {
        throw new Error("provider missing");
      },
      report: async (_id, _cycle, row) => {
        h.rows.push({ cycle: 1, row: structuredClone(row) });
      },
      log: () => {},
    });
    await broken.afterTurn(worker, reviewed);
    expect(h.last().phase).toBe("attention");
  });
});

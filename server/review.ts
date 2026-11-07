import type { CheckResult } from "../shared/status";

export type Verdict = "approve" | "changes" | "unknown";

/** The prompt for a reviewer that reads the worker's checkout and must not change it. */
export function reviewPrompt(round: number, checks: readonly CheckResult[]): string {
  const passed = checks.map((check) => check.name).join(", ");
  return [
    `You are reviewing another agent's uncommitted and committed work in this checkout (round ${round}).`,
    "Do not edit, create, or delete files, and do not commit or push.",
    "Read the diff against the base branch (for example `git diff` and `git log`), then judge correctness and whether the change is tested.",
    passed ? `The project's checks already passed: ${passed}.` : "",
    "List concrete findings, each with the file and what to change. Skip style nits.",
    "End your reply with exactly one line: `VERDICT: APPROVE` if the work is ready, or `VERDICT: CHANGES` if the findings must be fixed first.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Reads the last verdict line of a reviewer's reply. */
export function parseVerdict(reply: string | null | undefined): Verdict {
  if (!reply) return "unknown";
  const found = [...reply.matchAll(/^\W*VERDICT:\s*(APPROVE|CHANGES)\b/gim)];
  const last = found.at(-1);
  if (!last) return "unknown";
  return last[1]!.toUpperCase() === "APPROVE" ? "approve" : "changes";
}

/** The reviewer's findings, without the verdict line. */
export function findings(reply: string): string {
  return reply.replace(/^\W*VERDICT:.*$/gim, "").trim();
}

export function checkFeedback(failed: CheckResult, attempt: number, retries: number): string {
  const exit = failed.exitCode === null ? "did not finish" : `exited with ${failed.exitCode}`;
  return [
    `Mob ran the project's checks after your turn. \`${failed.name}\` ${exit} (attempt ${attempt} of ${retries}).`,
    "",
    "Last output:",
    "```",
    failed.tail ?? "",
    "```",
    "",
    "Fix the cause, then end your turn; Mob runs the checks again.",
  ].join("\n");
}

export function reviewFeedback(reply: string, round: number): string {
  return [
    `A reviewer read your work (round ${round}) and asked for changes:`,
    "",
    findings(reply),
    "",
    "Address the findings, then end your turn; Mob runs the checks and the review again.",
  ].join("\n");
}

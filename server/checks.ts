import { spawn } from "node:child_process";
import type { MobCheck } from "../shared/settings";
import type { CheckResult } from "../shared/status";

const TAIL_LINES = 40;
const TAIL_CHARS = 4_000;

/** The last lines of output, short enough to send back to an agent. */
export function tail(output: string): string {
  const lines = output.replace(/\s+$/, "").split(/\r?\n/);
  let text = lines.slice(-TAIL_LINES).join("\n");
  if (text.length > TAIL_CHARS) text = text.slice(-TAIL_CHARS);
  return text;
}

export type CheckRunner = (check: MobCheck, cwd: string, signal?: AbortSignal) => Promise<CheckResult>;

/** Runs one owner-typed check through the shell. A timeout counts as a failure. */
export const runCheck: CheckRunner = (check, cwd, signal) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(check.command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so a timeout also stops what the shell started.
      detached: process.platform !== "win32",
      env: { ...process.env, CI: process.env.CI ?? "1" },
    });
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > TAIL_CHARS * 8) output = output.slice(-TAIL_CHARS * 4);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let done = false;
    const stop = () => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      output += `\n[mob] ${check.name} timed out after ${check.timeoutSeconds}s`;
      stop();
      finish(null);
    }, check.timeoutSeconds * 1000);
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (exitCode: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      const ok = exitCode === 0;
      resolve({ name: check.name, ok, exitCode, ...(ok ? {} : { tail: tail(output) }) });
    };
    child.on("error", (error) => {
      output += `\n[mob] ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });

/** Runs checks in order and stops at the first failure, as Mob's `task_check` does. */
export async function runChecks(
  checks: readonly MobCheck[],
  cwd: string,
  run: CheckRunner = runCheck,
  signal?: AbortSignal,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await run(check, cwd, signal);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

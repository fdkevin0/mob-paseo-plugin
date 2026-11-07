import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCheck, runChecks, tail } from "../server/checks";
import { projectFor, repositoryRoot } from "../server/repo";
import { project } from "./helpers";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "mob-plugin-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("checks", () => {
  it("passes and fails by exit code, keeping the tail of failures", async () => {
    const ok = await runCheck({ name: "ok", command: "echo hi", timeoutSeconds: 10 }, scratch);
    expect(ok).toEqual({ name: "ok", ok: true, exitCode: 0 });
    const bad = await runCheck(
      { name: "bad", command: "echo out; echo err >&2; exit 3", timeoutSeconds: 10 },
      scratch,
    );
    expect(bad).toMatchObject({ ok: false, exitCode: 3 });
    expect(bad.tail).toContain("out");
    expect(bad.tail).toContain("err");
  });

  it("runs in the agent's directory", async () => {
    const result = await runCheck(
      { name: "cwd", command: `test "$(pwd)" = "${scratch}"`, timeoutSeconds: 10 },
      scratch,
    );
    expect(result.ok).toBe(true);
  });

  it("fails on timeout", async () => {
    const result = await runCheck({ name: "slow", command: "sleep 5", timeoutSeconds: 1 }, scratch);
    expect(result.ok).toBe(false);
    expect(result.tail).toContain("timed out");
  });

  it("stops at the first failure", async () => {
    const results = await runChecks(
      [
        { name: "a", command: "true", timeoutSeconds: 10 },
        { name: "b", command: "false", timeoutSeconds: 10 },
        { name: "c", command: "true", timeoutSeconds: 10 },
      ],
      scratch,
    );
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("keeps only the last lines", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const kept = tail(text).split("\n");
    expect(kept).toHaveLength(40);
    expect(kept.at(-1)).toBe("line 99");
  });
});

describe("repository", () => {
  const repo = path.join(scratch, "repo");
  const worktree = path.join(scratch, "repo-wt");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });

  it("finds the main checkout from a worktree and a subdirectory", async () => {
    execFileSync("git", ["init", "-q", repo]);
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("worktree", "add", "-q", "-b", "feature", worktree);
    execFileSync("mkdir", ["-p", path.join(repo, "src")]);

    expect(await repositoryRoot(repo)).toBe(repo);
    expect(await repositoryRoot(path.join(repo, "src"))).toBe(repo);
    expect(await repositoryRoot(worktree)).toBe(repo);
    expect(await repositoryRoot(scratch)).toBeNull();

    const projects = [project({ path: path.join(scratch, "other") }), project({ path: `${repo}/` })];
    expect((await projectFor(projects, worktree))?.path).toBe(`${repo}/`);
    expect(await projectFor(projects, scratch)).toBeNull();
    expect(await projectFor([], worktree)).toBeNull();
  });
});

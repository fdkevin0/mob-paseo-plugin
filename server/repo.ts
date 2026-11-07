import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { MobProject } from "../shared/settings";

const execFileAsync = promisify(execFile);

async function canonical(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

/** The main checkout of the repository that `cwd` belongs to, also from inside a worktree. */
export async function repositoryRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { timeout: 10_000 },
    );
    const common = stdout.trim();
    if (common === "") return null;
    const root = path.basename(common) === ".git" ? path.dirname(common) : common;
    return await canonical(root);
  } catch {
    return null;
  }
}

/** Finds the configured project for an agent's working directory. */
export async function projectFor(
  projects: readonly MobProject[],
  cwd: string,
  root: (cwd: string) => Promise<string | null> = repositoryRoot,
): Promise<MobProject | null> {
  if (projects.length === 0) return null;
  const repo = await root(cwd);
  if (repo === null) return null;
  for (const project of projects) {
    if ((await canonical(project.path)) === repo) return project;
  }
  return null;
}

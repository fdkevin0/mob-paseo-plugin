import type { MobProject } from "../shared/settings";

export type PolicyDecision = "allow" | "deny" | null;

/** Chaining, pipes, redirection, substitution, or a second line: never approved for you. */
const COMPOUND = /[;&|<>`\n\r]|\$\(/;

function matches(pattern: string, command: string): boolean {
  const wanted = pattern.trim();
  if (wanted.endsWith("*")) {
    const prefix = wanted.slice(0, -1);
    return command.startsWith(prefix);
  }
  return command === wanted;
}

/**
 * Decides a shell command for a project. `null` leaves the request to the owner.
 * Deny wins over allow; a compound command is never allowed, but can still be denied.
 */
export function decideCommand(project: MobProject, rawCommand: string): PolicyDecision {
  const command = rawCommand.trim();
  if (command === "") return null;
  if (project.deny.some((pattern) => matches(pattern, command))) return "deny";
  if (COMPOUND.test(command)) return null;
  if (project.allow.some((pattern) => matches(pattern, command))) return "allow";
  return null;
}

/** The provider ID of a selection such as `codex/gpt-5.5`. */
export function providerId(provider: string): string {
  const slash = provider.indexOf("/");
  return slash === -1 ? provider : provider.slice(0, slash);
}

/** Owner options for this provider, applied over what the agent was created with. */
export function providerOptionsFor(
  project: MobProject,
  provider: string,
): Record<string, unknown> | null {
  return project.providerOptions[providerId(provider)] ?? null;
}

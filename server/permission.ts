import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

/** The shell command a permission request asks to run, or null for any other kind. */
export function shellCommand(request: AgentPermissionRequest): string | null {
  if (request.detail?.type === "shell") return request.detail.command;
  const input = request.input;
  if (!input) return null;
  if (typeof input.command === "string") return input.command;
  if (typeof input.cmd === "string") return input.cmd;
  return null;
}

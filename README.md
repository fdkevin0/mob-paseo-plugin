# mob-paseo-plugin

[Mob](https://usemob.app) as a [Paseo](https://paseo.sh) plugin: a management layer that
runs your project's checks after every agent turn, sends failures back, has another agent
review the work, and answers routine permission requests by a policy you set.

Paseo already runs the agents, worktrees, terminals and mobile app. This plugin adds the part
Mob is about: deterministic steps between "the agent says it is done" and "you look at it".

## Plans

An agent in a configured project gets two tools: `mob_task_plan` and `mob_plan_status`.

1. **Propose.** When work splits into parts that can run at the same time, the agent proposes a
   plan of 1 to 6 tasks, each with its own instructions, provider and blueprint.
2. **Approve once.** The plan appears as a card in that agent's timeline. Nothing starts until
   you press **Approve and start** (or **Decline**).
3. **Start.** Mob creates one Paseo worktree per task on a `mob/<task>-<id>` branch and starts
   an agent there with the task's instructions. Each task then runs its blueprint (below).
4. **Report.** The card shows each task's state. When every task has finished, the proposing
   agent gets one summary to pass on to you. Nothing is pushed or merged.

Agents Mob starts for a task or a review do not get the tools, and an agent that proposed a
plan does not run the blueprint itself: its tasks do.

Paseo delivers plugin tools through the same gate as its own tools, so turn on **Enable Paseo
tools** (Settings → your host → Agents, or `daemon.mcp.injectIntoAgents`), then start or reload
the agent. Mob answers the tools' permission prompts itself, since a plan still waits for you.

## Blueprint

After a top-level agent finishes a turn in a configured project:

1. **Checks.** Mob runs the project's commands (tests, build) in the agent's checkout, in
   order, stopping at the first failure.
2. **Back to the agent.** A failure goes back into the same conversation with the end of its
   output, up to `checkRetries` times. Then Mob stops and asks you.
3. **Review.** With the `standard` blueprint and a `reviewer`, Mob starts a reviewer agent
   (a subagent of the worker, ideally another provider) that must end with
   `VERDICT: APPROVE` or `VERDICT: CHANGES`. Findings go back up to `reviewRounds` times; the
   review after the last round of rework is final.
4. **Status.** Each cycle gets a Mob card in the worker's timeline: checking, back to the
   agent, in review, ready, or needs you. Mob never pushes or merges.

Policy:

- **Hard options.** `providerOptions` are set on every new agent in the project, for example
  Codex `sandbox_mode: "workspace-write"`. A reviewer's own options win over them.
- **Permission answers.** Shell permission requests that match `deny` are declined, and ones
  that match `allow` are approved. Entries are exact commands or prefixes ending in `*`.
  Commands that chain, pipe, redirect or substitute are never approved automatically. Anything
  else is left to you.

Checks and policy live in the plugin's host settings, not in the repository, so an agent
cannot widen its own policy or plant a command by editing files in its worktree.

## Settings

Settings → Plugins → Mob → Projects takes JSON:

```json
{
  "projects": [
    {
      "path": "/absolute/path/to/repository",
      "blueprint": "standard",
      "checks": [{ "name": "tests", "command": "bun test", "timeoutSeconds": 600 }],
      "checkRetries": 2,
      "reviewRounds": 1,
      "reviewer": { "provider": "codex/gpt-5.5", "options": { "sandbox_mode": "read-only" } },
      "allow": ["git status*", "git diff*", "bun test*"],
      "deny": ["git push*", "rm -rf*"],
      "providerOptions": { "codex": { "sandbox_mode": "workspace-write" } },
      "plans": true,
      "taskProvider": "claude/claude-sonnet-5",
      "baseRef": "main"
    }
  ]
}
```

`path` is the main checkout; agents in its worktrees match too. Blueprints: `standard`
(checks, then review), `quick` (checks only), `manual` (nothing after a turn; policy only).
`plans` gives agents the plan tools; `taskProvider` is used for tasks that name no provider
(otherwise the proposing agent's); `baseRef` is where task worktrees branch off.

## Install

Plugins are trusted, unsandboxed code. Turn on **Enable plugins** in Settings → Plugins, then:

```bash
git clone https://github.com/fdkevin0/mob-paseo-plugin
paseo plugin install /absolute/path/to/mob-paseo-plugin
paseo plugin logs mob
```

Requires Paseo 0.15 or later.

## Known limits

- **State is in memory.** A daemon or plugin restart forgets retry and review counters (the
  next finished turn starts a new cycle) and plans: a card left waiting then explains that
  the agent has to propose it again, and running tasks stop updating their plan card.
- **Permission answers race you.** Paseo's `agent.permission.before` hook only notifies, so the
  request can show briefly before Mob answers it.
- **Subagents are skipped.** Agents with a parent (including Mob's reviewers) do not run the
  blueprint; their parent checks them.
- **Checks run as you**, through the system shell, with the daemon's environment.

## Development

```bash
bun install
bun run check        # typecheck + tests
paseo plugin reload mob
```

Layout follows Paseo's plugin rules: `index.server.ts` and `server/` run in the daemon's Node
subprocess, `index.client.tsx` and `client/` in every app, `shared/` in both. Tests live in
`test/` and are not shipped.

## License

MIT

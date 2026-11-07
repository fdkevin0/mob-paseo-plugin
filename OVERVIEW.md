Mob adds plans, checks, review, and a permission policy between an agent finishing its work and you looking at it.

An agent in a configured repository can propose a plan of up to six tasks that can run at the same time. The plan appears as a card in its conversation, and nothing starts until you approve it once. Mob then creates one worktree and branch per task, starts an agent in each with its instructions, and shows every task's progress on the card. When all tasks have finished, the proposing agent gets a summary to pass on to you. The plan tools reach agents only when Enable Paseo tools is on for the host.

After a top-level agent in one of your configured repositories finishes a turn, Mob runs the project's commands (such as tests or a build) in that agent's checkout. A failure goes back into the same conversation with the end of its output, a limited number of times, before Mob asks you. When the checks pass, Mob can start a reviewer agent, ideally from another provider, as a subagent of the worker. The reviewer reads the change without editing it and ends with a verdict. Its findings go back to the worker for a limited number of rounds. A Mob card in the worker's timeline shows each step and ends at "Ready" or "Needs you". Mob never pushes or merges.

The policy has two parts. Provider options, such as a Codex sandbox mode, are set on every new agent in the project. Shell permission requests that match your deny list are declined, and ones that match your allow list are approved. Commands that chain, pipe, redirect, or substitute are never approved automatically. Everything else is left to you.

## Setup

Open Settings, then Plugins, then Mob, and describe each repository in the Projects editor: its path, checks, retry and review limits, reviewer, allow and deny lists, and provider options. These settings live on the daemon host, not in the repository, so agents cannot change them.

## Limits

Checks run as the daemon user through the system shell. Retry and review counters are kept in memory and reset when the daemon or plugin restarts. Because Paseo reports permission requests to plugins without waiting, a request can appear briefly before Mob answers it.

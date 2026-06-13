---
---

docs(agents/improve): add worktree detection check before spawning executor

The improve skill now detects whether it's already running inside a git worktree (as in Conductor multi-workspace setups) and conditionally applies isolation. This prevents nested worktree creation and enables the improve skill to work correctly in Conductor.

---
name: start
description: "The front door of a role with no automatic trigger: start an issue in the factory for one of the project's roles, then launch its ticket thread. Typed as /start <issue> [<role>]."
disable-model-invocation: true
---

# Start

The owner runs this in a fresh thread of a project's T3 project: `/start <issue> [<role>]`. It starts the issue as the project's role says, at the role's entry stage, and launches the ticket's thread, as the feature thread launches a child. A role whose trigger is `command` has no other way to start (`docs/architecture.md`, "Roles and triggers"); any role can be started this way.

**The project.** `<file>` is the nearest `.factory/project.yaml` above this thread's working directory. Run every `factory` command with `--project-file <file> --json`. `factory --help` lists them.

## Steps

1. **Pick the role.** Read the project's roles: `factory config check --project-file <file> --json`, its `roles` array. When it is null, reply `<project> has no roles: declare roles: in its manifest, or start the issue with factory ticket start` and stop. Take the role named after the issue. With none named, take the project's one role whose `trigger` is `command`; with none or several, ask the owner which role, listing the names, and wait.

2. **Start the issue.** Run `factory ticket start <issue> --role <role> --project-file <file> --json`. It starts the issue in the default lane at the role's entry stage and records the role. When it refuses (an entry the lane's start rule won't allow, such as the `reviewer` preset's, or an issue that already has a ticket), reply with the command and the first line of its error, and stop.

3. **Launch the ticket's thread.** Run `factory thread plan <issue> --project-file <file> --json`; with `refreshCapabilities`, refresh the snapshot as `factory-ticket-thread` says and plan again. Launch and record it exactly as the `factory-router` skill's `launch_ticket_thread` steps 1 to 3 say, with the plan as the effect: `t3_thread_launch`, `t3_thread_wait`, the fallbacks, then `factory thread record <issue> --thread <threadId> --branch <launch.workspaceStrategy.branch> --project-file <file> --json`. A launch that fails on every model is left to the sweep, which launches a thread for any started ticket with none: say so.

4. **Reply** `started <repo>#<issue> for <role>: [<title>](t3-thread://v1/<threadId>)`.

Done when the ticket is started, its thread is recorded or left to the sweep, and the reply is posted.

## When a command fails

Reply with the command and the first line of its error, and stop. A ticket started without its thread gets one from the sweep.

---
name: setup-factory-project
description: "Onboard this repo into the software factory: project manifest, identity, board, autonomy profile, lane budgets, sensitive paths, model routing, tracker labels, a committed install of the factory skills and registry entry. Run once per repo, and again when its rules or the factory skills change."
disable-model-invocation: true
---

# Setup factory project

Write `.factory/project.yaml`, the file the `factory` CLI reads to run this repo's tickets, install and commit the factory skills so every worktree carries them, and register the repo with the factory. The manifest's fields and their meaning are defined by the schema in the factory repo (`src/config/schema.ts`, `ProjectManifest`). The reasons behind lanes, autonomy and routing are in its `docs/architecture.md`.

Explore, present what you found, confirm with the user, then write.

## Process

### 1. Check prerequisites

- `factory --help` runs. If it doesn't, the CLI isn't linked: ask the user to run `bun link` in their factory checkout.
- `docs/agents/issue-tracker.md` exists. The factory reuses the tracker that `setup-ygilany-skills` configured. If the file is missing, stop and ask the user to run `/setup-ygilany-skills` first.

- `factory skills check --json` exits zero: the `Ygilany/skills` skills installed on this machine are the ones the factory is pinned to. The stages and the feature thread compose `triage`, `grilling`, `to-spec`, `to-tickets`, `tdd`, `test-audit`, `code-review` and `pr` from that repo; they are installed once per machine, globally, at the pin, not in this repo. If the check fails, show the user the commands it printed, ask them to run them, and run it again. The factory launches no stage worker until it passes.

Done when all three hold.

### 2. Explore

Collect evidence for every manifest field, citing where each value came from:

- **tracker**: from `docs/agents/issue-tracker.md` and `git remote get-url origin`. GitHub needs `owner/name`, plus `host` for GitHub Enterprise (e.g. `git.uc.edu`). Note any GitHub Project board the repo uses.
- **base_branch**: the remote's default branch.
- **test_tiers**: the commands that run unit, integration and end-to-end tests, from `package.json` scripts, the Makefile or CI workflows. Each tier is a command the ticket thread can run as-is at merge, on a repo with no CI.
- **sensitive_paths**: the "Sensitive areas" table in `docs/agents/code-review.md` if present, plus auth, payments, data migrations and public API surfaces you find. The factory already treats migrations, lockfiles, CI workflows and `.env*` as sensitive everywhere (`always_sensitive` in `factory.yaml`). List only what this repo adds.
- **docs** and **site**: a documentation site and a marketing site or landing page, each by path. They are for the planned docs stage (#23): a repo that declares neither will skip it once it returns.
- **T3 project id**: from T3's `t3_project_list`, matched on this repo's path.
- **Identities available**: the `identities` in the factory's `factory.yaml` for this tracker's host. For each `github_app`, run `factory github-app status` to see whether it's installed on this repo.
- **The project's own process**: the repo's labels, with their descriptions (`gh label list -R <repo> --limit 1000 --json name,description`), and any GitHub Project its issues sit on with its Status field's options (`gh project list --owner <owner> --limit 1000`, then `gh project field-list <number> --owner <owner> --limit 1000`), all read as the owner. These commands return only 30 entries unless given `--limit`, so keep it; a list cut short drops labels from the Process question without any error. Skip the labels that start with `factory` (the factory's own, `factory:*` and the intake label).
- **Boards**: any GitHub Project the repo already uses (`docs/agents/` files, or `gh project list --owner <owner> --limit 1000`), and whether other onboarded repos share a factory board (`board:` in their manifests).

Done when every field has a proposed value or an explicit "not present".

### 3. Present and ask

Show the proposed manifest, then ask the questions below one at a time, each with your recommendation. Run `factory config show --project-file <draft>` to show the user the effective gates and models before they decide.

1. **Identity**: who the factory acts as on this repo's tracker.
   - **GitHub App** (recommended where you can install one): acts as `<app>[bot]`, so you get notifications and can approve its PRs; tokens last an hour and cover only this repo. If it isn't installed here yet, give the user the install link from `factory github-app status`.
   - **Bot account**: a second account logged into `gh` (an identity with `user:`). For hosts where you can't create an App but can add a collaborator.
   - **Your own account**: the host's default identity. The only option on GitLab and on enterprise hosts that allow neither, at the cost of no notifications for the factory's comments and no formal approval of its PRs.
2. **Board**: where the user watches this repo's tickets.
   - **New board** for this repo: `factory board setup --create --write`.
   - **Existing board**, this repo's own or a shared factory board other repos use: `factory board setup --number <n> --write`. The factory adds its Stage, Lane and Attention fields, its Thread text field and its views without touching existing fields.
   - **None**: labels and the dashboard only.
   Boards owned by a personal account must be written by a user identity (Apps can't), so `board.identity` defaults to the host's user identity. Board commands need the `project` scope: `gh auth refresh -h <host> -s project`.
3. **Autonomy profile**: `supervised`, `balanced` or `autonomous`. Recommend from the repo's stakes: a personal site leans autonomous, a client or company product leans supervised.
4. **Gate overrides**: any gate that should differ from the profile, per lane if needed.
5. **Quick-lane budget**: keep the global budget or tighten it.
6. **Routing**: which Claude account this repo's work runs on (`accounts`), any role that needs a stronger or cheaper model, and whether to keep free models away from this repo (`routing.exclude_tags: [free]`; recommend it for client, company and other confidential code, since free tiers may log prompts).
   **Labels**: keep the default (attention-only with a board, full without) unless the user wants otherwise (`labels: full | attention | none`).
7. **Process**: the meaning of the project's own labels and board statuses, so the factory reads their vocabulary and adds no second one beside it. Propose the `process:` block from what step 2 found, a meaning recommended for each label and status from its name and description: `category: <word>` (`bug`, `feature`), `priority: <word>`, `area: <word>`, or `ignore` when it says nothing the factory reads (`help wanted`, `wontfix`). The words are the project's own. Ask who the process is read as: the owner's `gh_user` identity, `me` or the host's default (`process.identity`; never the factory's App), and which board and field hold the statuses (`board: { owner, number, field }`, `Status` by default). The owner confirms or edits each entry. Labels the block doesn't name are left untouched, as `setup-labels` writes only `factory` and `factory:*` labels and never creates one the block names. Skip the question when the repo has no labels or board of its own worth mapping.

Done when the user has confirmed every answer.

### 4. Write and verify

1. Write `.factory/project.yaml`, with a comment on any value that isn't obvious.
2. Run `factory config check` in the repo, and fix the manifest until it passes. With a `process:` block it lists each label and status as `ok`, `missing` or `unchecked`: none may be `missing` (a name the repo doesn't have; fix it from the repo's real labels and board), and an `unchecked` one is the read failing, so fix `gh`'s sign-in as the process identity and run it again.
3. Install the factory skills into the repo and commit them, so every worktree carries them however it was created. Ticket threads and stage workers run in this repo's worktrees and load the `factory-*` skills from there; a script run on worktree creation doesn't reach the worktrees `t3_thread_launch` makes (#99). Skip this step in the factory repo itself: it commits links to its own `skills/`. Otherwise:
   1. Run once, in the repo's checkout:
      ```sh
      npx -y skills@1.7.2 add Ygilany/factory -y --agent claude-code codex --skill '*'
      ```
      The `skills` CLI version is pinned because the command relies on its defaults: project scope (it has no `-p` flag), so the skills land in `.agents/skills/` (Codex) with symlinks in `.claude/skills/` (Claude Code), plus a `skills-lock.json`. Bump the pin only after checking those defaults still hold.
   2. Check it: the `skills` CLI exits 0 even when a skill fails to install (it prints `Failed to install`), so look for each factory skill's `SKILL.md` under `.agents/skills/` and `.claude/skills/`.
   3. Commit what `skills add Ygilany/factory` wrote: `.agents/skills/factory-*`, `.agents/skills/setup-factory-project`, the matching `.claude/skills/` links, and `skills-lock.json`.
   4. When a factory skill changes, refresh the copy by running this skill again (or `npx -y skills@1.7.2 update` in the checkout) and committing what changes. Briefs also name each skill's source path in the factory checkout, so a worker whose copy is missing or stale can still read the skill.

   Done when the install is committed and a fresh worktree of the repo (`git worktree add`) has `.claude/skills/factory-ticket-thread/SKILL.md` and `.agents/skills/factory-ticket-thread/SKILL.md`.
4. With the user's go-ahead, run `factory ticket setup-labels`. It creates the `factory:*` lane, stage and status labels in the tracker, acting as the chosen identity.
5. If the user chose a board, run the `factory board setup` command for their choice with `--write`, then relay any step it reports for the user (adopted boards need their pipeline view's columns set to the Stage field once).
6. Add the repo to `projects/registry.yaml` in the factory checkout (slug, repo, local path, T3 project id), then run `factory config check` there.
7. Commit the manifest and the skills install on a branch and open a PR in this repo, unless the user prefers another route.

Done when `factory config check` passes in both repos, the factory skills are committed and a fresh worktree carries them, the tracker shows the factory labels, the chosen board shows the factory fields and views, and the PR (or the user's chosen alternative) exists.

---
name: commit
description: Plans multiple atomic git commits from working-tree diffs, groups and orders changes, stages each slice and commits in sequence. Use when the user says commit or asks for split ordered commits.
---

# commit

Work from **`git diff`** / **`git diff --stat`** vs `HEAD`. Untracked: **`git status`**. If **`git diff --cached`** is non-empty, run **`git restore --staged .`** unless the user asked to keep the index.

Cluster by **one intent per commit** (read patches, not only paths). Order: deps -> refactors that unblock -> behavior -> docs-only last.

| Slice | Typical contents |
|-------|------------------|
| Tooling | package manifests, lockfile, CI, lint config |
| Foundation | shared types/utilities imported elsewhere |
| Features / fixes | isolated behaviors |
| Docs | README, docs/ when separate |

Split files with **`git add -p`**; whole files with **`git add -- path`**.

Per commit in order:

1. Stage only that slice (`git add` / `-p`).
2. **`git diff --cached`** - scope matches plan.
3. **`git commit -m "type(scope): subject"`**

Repeat until clean.

```bash
git status -sb && git diff --stat && git diff
```

Verify: **`git log --oneline -n N`**.

Avoid **`git add .`** / **`git commit -a`** before splitting.

Message shape: imperative subject ~72 chars; types `feat|fix|docs|style|refactor|test|chore`.

# Project board

AskDB's priorities and release scope live on GitHub Project **#27** (`https://github.com/users/Ygilany/projects/27`), owner `Ygilany`, project id `PVT_kwHOAKvYN84BZPEL`. Issues stay the record of *what* the work is (see `issue-tracker.md`); the board records *how much it matters and when it ships*. Who filed and who is working on an item is recorded in its body (see **Thread lines**).

## Ownership

| Field | Values | Set by |
| --- | --- | --- |
| **Priority** | `P0` security or cross-tenant leak · `P1` must land before the 1.0 RC · `P2` should do · `P3` someday | Maintainer |
| **Milestone** (issue field) | the release the item gates | Maintainer |
| **Workstream** | `Consumer lab`, `Safety & guardrails`, `Docs accuracy`, `Core API, CLI & HTTP`, `Studio`, `Introspection & connectors`, `AI, RAG & packaging`, `Release & repo ops`, `Test & code health` | Agent proposes, maintainer confirms |
| **Status** | `Inbox` → `Backlog` → `Ready` → `In progress` → `In review` → `Done`; `Blocked` | Agent keeps it current |

A thread's **lane** is the Workstream named in its charter (the thread's first message or the maintainer's latest restatement). A thread works items in its lane, plus items the maintainer hands it directly.

## Thread lines

The thread ID is the T3 worktree directory name (e.g. `t3code-49ff058e`). Two lines at the bottom of an issue body, below a `---` rule, record the threads involved:

- `Thread ID: <id>`: the thread that filed it (the footer `AGENTS.md` requires). Written once.
- `Worked on by: <id>`: the thread that picked it up. Added when work starts; a PR's own `Thread ID` footer covers the rest.

## Steps

1. **Choosing what's next**: take the highest-Priority `Ready` item in your lane (query below). Before the first commit, set Status `In progress` and add your `Worked on by` line to the issue body.
2. **Finding work along the way** (a bug, a doc mismatch, a gap): file an issue per `issue-tracker.md`, add it to the board with Status `Inbox`, set the Workstream you'd propose, and leave Priority empty. List it in your next summary to the maintainer. Your current item stays your focus; the new issue waits for the maintainer to route it.
3. **Opening a PR**: `Closes #<n>` in the body, and set the issue's Status to `In review`.
4. **Needing a decision**: add the `needs-decision` label and a `## Decision needed` section to the issue or PR body: the options, their trade-offs, and your recommendation. Set Status `Blocked`. Remove the label once the maintainer answers, and record the answer in the body.
5. **Blocked on another item**: native `blocked by` link (see `issue-tracker.md`) and Status `Blocked`.

Done when the board matches reality: every item you touched this session shows its true Status, and every issue you filed is on the board.

## Commands

```bash
P=27; O=Ygilany; PID=PVT_kwHOAKvYN84BZPEL

# Next Ready work in a lane, highest priority first
gh project item-list $P --owner $O --format json --limit 1000 --jq '.items[]
  | select(.status=="Ready" and .workstream=="Consumer lab")
  | "\(.priority) #\(.content.number) \(.title)"' | sort

# Add an issue or PR to the board (idempotent); prints the item id
gh project item-add $P --owner $O --url https://github.com/Ygilany/AskDB/issues/<n> --format json --jq .id

# Item id of an issue already on the board
gh project item-list $P --owner $O --format json --limit 1000 --jq '.items[] | select(.content.number==<n>) | .id'

# Set a single-select field by name: set_field <item-id> <Field> <Option>
set_field() {
  local f; f=$(gh project field-list $P --owner $O --format json)
  gh project item-edit --project-id $PID --id "$1" \
    --field-id "$(jq -r --arg n "$2" '.fields[] | select(.name==$n) | .id' <<<"$f")" \
    --single-select-option-id "$(jq -r --arg n "$2" --arg o "$3" '.fields[] | select(.name==$n) | .options[] | select(.name==$o) | .id' <<<"$f")"
}
set_field <item-id> Status "In progress"
```

The `gh` token needs the `project` scope (`gh auth refresh -s project`).

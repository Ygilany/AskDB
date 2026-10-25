# Posting a pending review on GitHub

The default forge. For another forge, the profile's *Posting* section names the CLI and commands; the contract stays the same: a draft or pending review, line-anchored comments, tagged bodies, and the verdict left to a human. (GitLab's equivalent is draft notes: `glab api projects/<id>/merge_requests/<iid>/draft_notes`.)

API: [Pull request reviews](https://docs.github.com/en/rest/pulls/reviews). On GitHub Enterprise, add `--hostname <host>` to each `gh api` call.

**Identity.** `gh` posts as whichever account it is logged in to (`gh api user --jq .login`): usually the user's own, and often the PR author's. The review therefore speaks for that person. Leave it pending for them to read and submit; submit it yourself only as `COMMENT`, and only when the profile or the user asks. `APPROVE` and `REQUEST_CHANGES` are never sent by this skill (GitHub also rejects both from a PR's author).

## 1. Resolve the target

```bash
PR=123
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
HEAD=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
```

## Prior findings

Collect earlier review findings before hunting, so the review checks their fixes instead of raising them again. Do this while building the case file (step 2 of the skill), not when posting; the lens agents read it from there.

```bash
# Inline findings: the top-level comments (in_reply_to_id null) are the findings; the replies say how each was handled
gh api --paginate "repos/$REPO/pulls/$PR/comments?per_page=100" | jq -s 'add | . as $all
  | map(select(.in_reply_to_id == null) | . as $f
    | {id, user: .user.login, path, line, body, replies: ($all | map(select(.in_reply_to_id == $f.id) | .body))})'

# Review summaries
gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" | jq -s 'add | map(select(.state != "PENDING") | {user: .user.login, state, body})'
```

Both commands fetch every page, then join them in one `jq -s`: a PR's comments often run past one page, and `gh api --jq` would filter each page on its own, losing replies that sit on a different page from their finding.

A reply's commit may have been rebased away; judge each fix by the current code, not by the reply. When a finding comes up again at the same place and its fix is complete, drop it; when the fix is incomplete, keep it and link the earlier comment in yours. Name dropped repeats in the review body with a link.

## 2. Check for an existing pending review

GitHub allows one pending review per user per PR; a second create fails with 422.

```bash
gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" --jq '.[] | select(.state=="PENDING") | .id'
```

If one exists, stop and report it (its id and link) to the user: it may hold their own drafts. Post nothing until they have dealt with it.

## 3. Write the payload

`review.json`, with no `event` field so the review is created **PENDING**:

```json
{
  "commit_id": "<HEAD sha>",
  "body": "> AI review via code-review, run by octocat's agent. Not a human review and not an approval.\n> Lenses: spec (Claude Sonnet 5.5), standards (Claude Haiku 4.5), architecture (Claude Opus 5.5), defects (Claude Opus 5.5), tests (Claude Sonnet 5.5), docs (Claude Haiku 4.5). Aggregator: Claude Haiku 4.5. Verifiers: Claude Opus 5.5 (2).\n\nVerdict: Fix first. Lenses run: all six. 2 blocking, 1 should fix. Dismissed after verification: ... Not reviewed: ...",
  "comments": [
    {
      "path": "src/validate.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "**Security:** (blocking) An unterminated quote falls through to the `default` branch, which allows the input (fail-open). Input: `'abc`. Reject unclassifiable input instead."
    },
    {
      "path": "src/config.ts",
      "start_line": 10,
      "start_side": "RIGHT",
      "line": 14,
      "side": "RIGHT",
      "body": "**Correctness:** (should fix) `timeout` set under `[server]` is read only from `[client]`, so the user's value is silently discarded. Warn or error on the misplaced key."
    }
  ]
}
```

- **Disclosure block.** The first lines of `body`, written by the lead from the case file's *Models* record: `> AI review via code-review, run by <account>'s agent. Not a human review and not an approval.`, then `> Lenses: <lens> (<model name>), …. Aggregator: <model name>. Verifiers: <model name> (<count>).` Use model names, and add ids only when the harness exposes them. A subset run lists only the lenses that ran.
- `line` is the line number in the file, on `side`: `RIGHT` for the new version (added or context lines), `LEFT` for deleted lines (old line number). It must fall inside a diff hunk, or the API returns 422 (`Line could not be resolved`): that finding is not anchored in the diff, so move it into the review body with its `path:line` and post again. A repeat of the same defect elsewhere ends the comment with "This issue also appears on `path:line`".
- Multi-line comments add `start_line` (the range must sit in one hunk). `start_side` is optional: it defaults to `side`, and single-line comments omit both `start_*` fields.
- Use `line`/`side`, not the older `position` (an offset from the hunk header).
- A comment body may carry a GitHub suggestion block (a fenced block tagged `suggestion`, holding the replacement for the anchored lines); JSON-escape its newlines and backticks like any other text. A suggestion on a multi-line range replaces the whole range.

## 4. Create the pending review

```bash
gh api -X POST "repos/$REPO/pulls/$PR/reviews" --input review.json --jq '{id, node_id, state, html_url}'
```

Expect `"state": "PENDING"`. The review is visible only to its creator until submitted.

**Verify the comments landed.** Over REST, a pending review's comments report `line`, `side`, and `start_line` as `null` (only `position` is set), which looks like a failed post but is not. Verify by count, or by GraphQL, which reports the lines:

```bash
# Count: expect the number of comments in review.json
gh api --paginate "repos/$REPO/pulls/$PR/reviews/<id>/comments?per_page=100" | jq -s 'add | length'

# Lines: <node_id> is from the create response
gh api graphql -f id=<node_id> -f query='
  query($id: ID!) {
    node(id: $id) {
      ... on PullRequestReview {
        comments(first: 100) { totalCount nodes { path line startLine } }
      }
    }
  }'
```

## 5. Submit, only when the profile or the user says so

```bash
gh api -X POST "repos/$REPO/pulls/$PR/reviews/<id>/events" -f event=COMMENT
```

Submitting keeps the body set at creation, disclosure line included; passing `-f body=` here would replace it. `COMMENT` is the only event this skill submits (see **Identity** above).

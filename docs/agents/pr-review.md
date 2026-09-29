# PR review: AskDB

AskDB's configuration for the generic `pr-review` skill (see `AGENTS.md`, "PR review"). The skill supplies the review steps; this file supplies what to check in this repo, where to look harder, how to verify, and how to post. Each rule here points at its source (`AGENTS.md`, `CONTRIBUTING.md`, a skill); when a source changes, update the rule here in the same PR.

## When review is required

- Every PR opens as a draft and gets an independent review before it is marked ready for review.
- The reviewer is a different agent or session from the one that wrote the change. A session that wrote or edited any part of the diff stops and hands the review to a fresh agent: an author checks its own diff against the same mental model that wrote it, which is how #190, #192, and #197 reached review with defects only Copilot caught.
- Re-check the PR title and description against the final diff after every push. Re-run the review on the new commits (`git diff <last-reviewed-sha>..HEAD`) when non-trivial code changes land after it.
- The PR leaves draft only when every finding is fixed in a commit or answered in a reply on its thread.

## Repository conventions

Apply every rule to every PR.

- **SQL is returned, never executed.** No code path in `packages/core` or any public surface runs generated SQL; execution belongs in a host app, fixture, or test harness (`AGENTS.md` Conventions). Check new database-driver imports and any new `query`/`execute` call outside `*.test.ts`, fixtures, and `examples/`.
- **Changeset for publishable changes.** A change under `packages/*/src`, `packages/*/package.json`, or `apps/{cli,http-api,studio}/{src,package.json}` carries a `.changeset/*.md` (the same path filter as `.github/workflows/changesets.yml`). AskDB is pre-1.0: a breaking change is a `minor`, never a `major`. Run `pnpm changeset status --verbose` and flag any package bumped `major` unintentionally.
- **Docs-site accuracy.** Every claim a PR adds or edits under `apps/docs-site/src/content/docs/` (package names, APIs, options, file paths, defaults, error text) matches the source; find each one with `git grep` before accepting it. A public API or integration-pattern change without a docs-site update is a finding.
- **Docs house style.** Markdown and MDX follow `apps/docs-site/STYLE.md` and `AGENTS.md`: one line per paragraph or list item (unwrapped), sentence-case headings, the terminology table.
- **Exported signatures name exported types.** Every type named in an exported function, class, or type signature is re-exported from the package entry point (`src/index.ts`), not reachable only through an internal path. #197 named `TenantSqlDialect` in a signature without re-exporting it until review caught it. Read `src/index.ts` against new and changed signatures; this stays manual until #325 adds a mechanical check.
- **Integration suites gate through `integrationSuite()`.** Suites that need a database, a native driver, or an env var use `integrationSuite()` from `scripts/test-utils/integration.mjs`, so CI's `ASKDB_REQUIRE_INTEGRATION=1` turns a missing prerequisite into a failure. `pnpm lint` runs `scripts/check-test-gating.mjs` over every workspace package in `pnpm-workspace.yaml`; it rejects `describe`/`suite` `.skip`/`.skipIf`/`.runIf`, `it`/`test` `.skipIf`/`.runIf`, `it.skip` used as a value, and `cond ? describe : …`, and allows a line exempted with `// check-test-gating-ignore-next-line: <reason>` (question any new exemption). Still read new suites for gates it cannot see (an early `return` in `beforeAll`, a conditional `it` inside a loop).
- **Tests pass the test-audit authoring gate.** New and changed tests meet `.agents/skills/test-audit/SKILL.md`: each names the behavior it protects; a regression test fails on the pre-fix code for the intended reason (flag it when neither the PR nor the diff shows that); it asserts the specific rule or error code, not a permissive helper any rejection satisfies; and it lives at the owner boundary where users hit the behavior. For a Studio save bug that is the Studio server route (`apps/studio/src/server.ts`), not only the `@askdb/enrich` helper it calls (#192).

## Sensitive areas

| Glob | Checklist | Built-in security review |
|---|---|---|
| `packages/core/src/sql/**` | SQL guardrails | yes |
| `packages/core/src/schema/**` | SQL guardrails | yes |
| `**/*tenant*` | SQL guardrails | yes |
| `**/*sensitiv*` | SQL guardrails | yes |
| `packages/rag/src/stores/**` | SQL guardrails | yes |
| `apps/studio/src/server*` | — | yes |
| `apps/studio/src/request-guard*` | — | yes |
| `apps/http-api/**` | — | yes |

A changed file that quotes, escapes, or lexes SQL but matches no glob gets the same treatment as `packages/core/src/sql/**`. The built-in security review is `/security-review`, run by the same independent reviewer; fold its findings in under **Security:**.

## Checklists

### SQL guardrails

Work every item; note a skipped item in the review body with the reason. Probe the built code directly instead of reasoning about what an input would do: `pnpm build`, then `node --input-type=module -e "import { validateSelectSql, MYSQL_DIALECT } from './packages/core/dist/index.js'; try { console.log('accepted:', validateSelectSql(MYSQL_DIALECT, 'SELECT 1 /*! x')) } catch (e) { console.log('rejected:', e.message) }"`. The probes are the adversarial corpus the author did not write.

1. **Dialect matrix.** Exercise each built-in dialect (`BUILT_IN_DIALECTS` in `packages/core/src/sql/dialect-spec.ts`), no dialect, a custom dialect id, and a partial `DialectSpec` (only some fields set). For each setting the change reads, state what "unset" means and confirm every module that reads it agrees. #197 escaped MySQL literals correctly only with the full spec; a partial spec broke out of the literal.
2. **Token kind × termination.** For each of `'…'`, `E'…'`, `$tag$…$tag$`, `"…"`, `` `…` ``, `[…]`, `N'…'`, `--`, `#`, `/*…*/`, and `/*!…*/`, try: terminated; unterminated at end of input; an escaped or doubled delimiter inside; the token hiding a keyword, column, or placeholder. #190 missed an unterminated `/*!`; #197 failed open on Postgres `E'…'`.
3. **Prefixes between `SELECT` and the projection.** MySQL `DISTINCTROW`, `HIGH_PRIORITY`, `STRAIGHT_JOIN`, `SQL_*` modifiers; Postgres `DISTINCT ON (…)`; SQL Server `TOP n`, `TOP (expr)`, `PERCENT`, `WITH TIES`. #190's wildcard check was bypassed by a MySQL `SELECT` modifier.
4. **FROM-clause forms and scope.** Parenthesized FROM items, a comma join after `JOIN … ON`/`USING`, `STRAIGHT_JOIN` as a join operator, Postgres `TABLE t` shorthand (#306–#309); and scope: subqueries, `EXISTS`, CTEs, correlated references, aliases that shadow a table or an outer alias.
5. **Failure direction.** For every ambiguous or unparseable input, name which way the guardrail fails and why that direction is safe for this guardrail. The sensitive-column check over-reports (ambiguous text counts as a reference); the tenant-predicate check does not count ambiguous text as a predicate (a comment or string that looks like `tenant_id = …` is not scoping). A fail-open path is a **Security:** finding.
6. **Silent discard.** Any user-supplied privacy or tenant setting that fails to apply throws or warns: misplaced or duplicate column IDs, a setting on the wrong owner, unknown keys, values lost on a Studio save round-trip. #192, as first written, silently dropped `sensitive: true` on a misplaced or duplicate column ID and synthesized warning paths from the wrong filename; check the warning names the right file and path.
7. **Reused code, new meaning.** Code reused to carry a security decision it did not carry before (a lexer or helper now feeding a guardrail) is reviewed as if new, against items 1–6.

### Description vs diff

The PR title and description match the final diff after the last push, including merges, rebases, review-fix commits, and test-audit commits. Check every concrete claim against the branch, not memory:

- each named test exists: `git grep -n "<test name>"`, or `pnpm --filter <package> exec vitest list --config ../../vitest.config.ts <path>`;
- each named export, option, or file exists at the stated path;
- each count ("adds 12 cases", "3 dialects") matches;
- each behavior claim ("fails closed on X") is what the code does.

#192's description claimed tests its own test-audit commit had removed; #197's title and description described an earlier revision. A stale claim goes in the review body.

## Verification commands

Packages resolve each other through `dist`, so build before running a single package's tests.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint            # includes scripts/check-test-gating.mjs
pnpm test            # integration suites run only when their env vars are set (CONTRIBUTING.md)
pnpm docs:build
pnpm smoke:install
pnpm preflight
pnpm --filter <package> exec vitest run --config ../../vitest.config.ts <path-or-filter>
```

## Posting the review

Post to GitHub (`Ygilany/AskDB`) with `gh` as one PENDING review: omit `event`, and the review stays visible only to the posting account until submitted. Inline comments land on right-side diff lines (check with `git diff -U0 <base>...HEAD -- <path> | grep '^@@'`; `+c,d` covers new-file lines `c` to `c+d-1`); a finding with no diff line (missing test, missing changeset, stale description) goes in the review body.

Start every comment with one tag:

- `**Security:**` guardrail bypass, fail-open path, literal or identifier breakout, sensitive data exposed, SQL executed by AskDB;
- `**Correctness:**` wrong result, crash, a setting silently discarded;
- `**Tests:**` hand-rolled gate, regression that never failed pre-fix, permissive assertion, wrong boundary, missing case;
- `**Docs:**` docs-site claim not backed by source, house-style break;
- `**Conventions:**` any other rule above: changeset, unexported type in a signature, PR description that disagrees with the diff, stacked-branch merge.

Payload (`/tmp/askdb-review-<pr>.json`), with `commit_id` from `gh pr view <pr> --json headRefOid -q .headRefOid`:

```json
{
  "commit_id": "<head sha>",
  "body": "Independent review (pr-review). Spec: <source>. Checklists applied: <list>.\n\n<body-only findings, tagged>\n\n<items checked clean>",
  "comments": [
    { "path": "packages/core/src/sql/lexer.ts", "line": 212, "side": "RIGHT", "body": "**Security:** …" },
    { "path": "packages/core/src/sql/validate.ts", "start_line": 88, "line": 94, "side": "RIGHT", "body": "**Correctness:** …" }
  ]
}
```

GitHub allows one pending review per user per PR. If one already exists, stop and report it rather than deleting it: it may be the maintainer's own draft.

```bash
PR=<number>
gh api "repos/Ygilany/AskDB/pulls/$PR/reviews" --jq '.[] | select(.state == "PENDING") | .id'
REVIEW_ID=$(gh api -X POST "repos/Ygilany/AskDB/pulls/$PR/reviews" --input "/tmp/askdb-review-$PR.json" --jq .id)
```

Leave the review PENDING for the maintainer unless the person who asked for the review says to submit it. Submit only as `COMMENT`:

```bash
gh api -X POST "repos/Ygilany/AskDB/pulls/$PR/reviews/$REVIEW_ID/events" -f event=COMMENT
```

The event is `COMMENT` every time. Approval is the maintainer's decision, and the review usually runs under the maintainer's own `gh` account, so an `APPROVE` would be the author approving themselves.

## Stacked PRs

The repo uses GitHub native stacks, which need linear history. Update a stacked branch by rebasing it onto its parent (`git rebase`, then `git push --force-with-lease`), and diff a stacked PR against its parent branch (`gh pr view <pr> --json baseRefName`), not `main`. A merge commit from `main` in a stacked branch is a **Conventions:** finding.

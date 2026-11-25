---
name: verify-bound-forms
description: "Property check that every executable form `bindPreparedQuery()` returns binds each tenant ID and business value into its own slot, run against a live SQLite. Use when a change touches placeholder scanning, literal escaping, tenant placeholder substitution, `?` marker alignment, `renderTemplate`/`renderTenantSql`, `bindPreparedQuery()`, or the check itself."
---

# Verify bound forms

`bindPreparedQuery()` returns up to three ways to run one statement: `unboundSql` + `params`, `sql` + `tenantParams` (`tenantSqlMode: "sql-params"`), and `sql` alone (`"sql-only"`). `ask()` renders through the same `renderTemplate` and `renderTenantSql`.

- **Property:** for every template in the check's grammar and every generated value and tenant scope, the three forms return the same rows from a live SQLite, and those rows are the ones the template means.
- **Harm if it breaks:** a tenant ID lands in a business slot or in another tenant root's slot, or an inlined literal reads as a different value. The query then filters by the wrong tenant and returns rows the caller must not see. That is a vulnerability under [ADR 0046](../../../docs/adrs/0046-a-vulnerability-is-a-break-in-something-askdb-owns.md): see [security triage](../../../docs/agents/security-triage.md) before you write about a failure anywhere public.

The check is [`packages/sqlite/src/verification/bound-forms-agree.test.ts`](../../../packages/sqlite/src/verification/bound-forms-agree.test.ts). TypeScript has no code-level verifier this repo could run, so it's a property-based test with fast-check that calls the real public API. The oracle has two halves: a live in-memory SQLite (better-sqlite3) runs each form, and a plain-JS meaning for each `WHERE` conjunct computes the expected rows from the seeded rows, without SQL. A pass covers the grammar and the cases generated, not every input.

## 1. Does your change touch it?

```bash
node .agents/skills/verify-bound-forms/covered.mjs   # this branch against origin/main, with uncommitted files; --base <ref> for another base
```

Exit 3 means it does, and each line says why: `covered` (a file in the table below), `sql` (another source file under `packages/core/src/sql/`) or `check` (the check itself). Exit 0 means no path it knows changed. A path can't show what a hunk does, so two calls stay yours: on an `sql` line, and on any code elsewhere, a change that writes `params`, `tenantParams`, `bindings[].indices` or the text that replaces a placeholder touches it, and that file joins the table and `COVERED` in `covered.mjs`.

| File | What the check covers |
|---|---|
| `packages/core/src/sql/rebind.ts` | `bindPreparedQuery` |
| `packages/core/src/sql/checked-statement.ts` | `renderTemplate`, `bindTenantIntoUnboundSql`, `renderTenantSql`, `assertRenderedSql` |
| `packages/core/src/sql/bind.ts` | `renderPreparedQuery`, `escapeSqlLiteral`, `escapeSqlLiteralList`, `scanPlaceholders`, `tokenizeSqlSpans`, `isValidListContext`, `markerStyleForDialect` |
| `packages/core/src/sql/tenant-placeholders.ts` | `resolveTenantSql`, `substituteTenantPlaceholders`, `replacePlaceholdersWithParams`, `replacePlaceholdersWithLiterals`, `escapeTenantId`, `planEdit` |
| `packages/core/src/sql/lexer.ts`, `readings.ts` | the SQLite reading of strings and comments (`placeholderReading`) |

Sync commit: `89dfa8524961b251750af40d21bcb146948d485a` (2026-11-19). At this commit the check was confirmed to describe the code above. To see what changed since then:

```bash
node .agents/skills/verify-bound-forms/covered.mjs --since-sync --diff
```

## 2. Run it

```bash
.agents/skills/verify-bound-forms/run.sh                            # 300 cases, about a second
ASKDB_VERIFY_RUNS=20000 .agents/skills/verify-bound-forms/run.sh    # deep run before a PR that touches covered code
ASKDB_VERIFY_SEED=<seed> .agents/skills/verify-bound-forms/run.sh   # replay a failure with the seed it printed
```

`run.sh` builds `@askdb/core` first: the check imports `@askdb/core` from its `dist`, so a stale build checks old code. The check also runs on every `pnpm test` (turbo `test` for `@askdb/sqlite`) at 300 cases. It needs no Docker and no network.

Done when `run.sh` exits 0 at 20000 cases on your change. CI's `bound-forms` job runs `covered.mjs` on every PR and, on exit 3, the 20000-case run and the mutants, so a PR that skipped this still gets both.

## 3. Read a failure

fast-check shrinks to a small case and prints it, then the cause:

```
Caused by: AssertionError: [sql-params] SELECT id FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = :s1
  unboundSql + params: SELECT id FROM orders WHERE agency_id IN (?) AND status = ?: expected [] to deeply equal [ 1 ]
```

Read it as: under `sql-params`, the template on the first line returned no rows through `unboundSql` + `params`, where the template means row 1. The counterexample JSON above it gives `values`, `agencyIds`, `clientIds` and the `rowPicks` that seed the rows. Tell the user the story as steps in the code's words: which placeholder, which value, which slot it landed in.

Then decide whether it's a bug in the code or an error in the model:

- **A wrong row set.** Run the printed form by hand on the seeded rows (better-sqlite3 in a scratch script). If SQLite returns what the template means and the form returns something else, the form is wrong: that's a **bug**. If SQLite's own reading differs from the conjunct's JS `holds` (type affinity, NULL, collation, how SQLite parses a number), the **model** is wrong. Fix `holds` and cite the SQLite documentation for the reading.
- **`refused a template it must bind`.** The grammar holds only templates that must bind, so a refusal is either a regression, or a form the product now refuses on purpose. Count it as on purpose only with evidence in the change (an ADR, a contract in `docs/contracts/`, a changeset, a doc comment). Then remove that form from the grammar and cite the evidence in the test's comment.
- **`bound a control character` / `inlined a tenant ID it can't inline safely`.** A documented refusal (`INVALID_VALUE`, `UNESCAPABLE_TENANT_ID` in `sql-only`) stopped happening. That's a bug unless the contract changed, with evidence as above.

A bug stays a bug. Report it, and leave the property, grammar and bounds as they are. Change product code only when the user asks.

## 4. Change the check for an intended change

- **The code changed shape** (a function split or moved, a new path that writes `params` or replaces a placeholder): add it to the coverage table, and extend the grammar if the new path needs a form it lacks.
- **The promise changed on purpose:** change the property, the grammar or the documented refusals in the test. Write the old wording, the new wording and the evidence in the PR.
- **After any edit to the check or to covered code:** run `node .agents/skills/verify-bound-forms/mutants.mjs`. It applies six scratch breaks to core, such as tenant values appended after the business values on a `?` dialect, or only the first quote doubled. It runs the check unbroken first and stops with exit 2 if that fails. Then it runs the check on each break, counting a break as `caught` only when the property itself fails, and restores the files exactly; an interrupted run is undone by its signal handler or by the next run's first step (`restored a file an interrupted run left broken`). Every break must print `caught`. `NO LONGER APPLIES` means a break's text moved: update the break in `mutants.mjs` to break the same thing in the new code. `MISSED` means the check lost the ability to fail: fix the check. `ERRORED` means the check failed for another reason, such as a load error: fix that first.
- **Moving the sync commit:** move it forward only after you have read every change to covered code since the old commit, seen `run.sh` pass at 20000 cases, and seen `mutants.mjs` catch every break, all at the new commit.

## 5. What it doesn't cover

Say these limits whenever you report a pass:

- **One engine and one marker style:** it runs dialect `sqlite` on SQLite only. The `?` interleaving it checks is the code MySQL and MariaDB share, but their backslash escaping (`backslashEscapes`, `NO_BACKSLASH_ESCAPES`) is unchecked. Postgres and CockroachDB `$n` markers, array list binding (`= ANY($n)`), SQL Server `@pN`, `standard_conforming_strings` and connection charsets are unchecked too.
- **SQLite can't show the backslash hazard:** it reads a backslash in a string as text, so the check enforces the `sql-only` backslash refusal from the contract, not from an engine.
- **A bounded grammar:** one `orders` query with a `clients` subquery, at most two agency and two client tenant conjuncts and five business conjuncts. There are no joins, CTEs, `ORDER BY` placeholders, `subtree` scopes (they must arrive expanded), `global` scopes or host `DialectSpec`s.
- **Booleans:** the harness passes `1`/`0` to the driver, as a SQLite host must, because better-sqlite3 binds no booleans.
- **The guardrail decisions:** whether the tenant, read-only or sensitive check should allow a template is out of scope. The check requires only that each template in its grammar binds with verdict `allow`.

Known observation, outside the property: a template written `id -:n1` with a negative value renders `id --5`, which the read-only check refuses as a comment. It fails closed, so it's no safety bug, but a valid template is refused.

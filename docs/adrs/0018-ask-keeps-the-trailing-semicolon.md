# ADR 0018 — `ask()` keeps the model's trailing semicolon

## Status

Accepted (2026-10-07, maintainer decision in the #452 thread, PR #455; filed as #477). Implemented in `packages/core/src/sql/validate.ts` (`validateSelectSql`) and PR #482.

## Context

A model's reply usually ends its statement with a `;`: `gpt-4o-mini` ended all 58 of its accepted catalog replies with one in #455's recording, and the NL→SQL prompt allows it ("End with optional semicolon"). The single-statement check (`SQL_MULTI_STATEMENT`) accepts one trailing `;` and rejects any other.

Until `1.0.0-beta.43`, `validateSelectSql` also removed that `;` and returned the rest, so the SQL `ask()` returned was not the statement the model wrote, by one character, and nothing said so. Hosts came to rely on it: the docs' row cap, `` `SELECT * FROM (${sql}) AS askdb_q LIMIT 1000` ``, and Studio's Playground **Execute** wrap the statement in a subquery, where a `;` is a syntax error on every engine.

## Options considered

### A. Remove the `;` in core (the behavior before this decision)

Rejected. It shapes the statement for one way of running it, a subquery wrap, which is the host's business: AskDB returns SQL and never runs it (`docs/mission.md`, `AGENTS.md` "Conventions"). The edit is silent, and every host that wraps the statement still has to know the `;` was removed for it.

### B. Keep the `;`; the host removes it when it wraps the statement (chosen)

`ask()` returns the statement as the model wrote it. A host that wraps it removes the terminator, like the wrap itself.

## Decision

- `validateSelectSql` returns the SQL trimmed and otherwise as written: a single trailing `;`, and any whitespace before it, is kept. The dialect's `extraValidate` still runs on the statement without it.
- The single-statement check is unchanged: any `;` other than one trailing `;` throws `SQL_MULTI_STATEMENT`.
- Each SQL output keeps the `;` of the model block it comes from: `sql` from the ```` ```sql ```` block, `unboundSql` and `preparedQuery.namedSql` from the ```` ```sql-unbound ```` block, and `bindPreparedQuery`'s `sql` and `unboundSql` from `namedSql`. AskDB doesn't make them agree when the model's two blocks don't, since that would be editing the model's text again. The parameterize consistency check ignores the terminator and the whitespace before it.
- A host that wraps the statement removes the `;` first. Studio's Execute does (`validateExecuteSql`), and the docs' row cap shows how (`guides/run-safely-in-prod.mdx`, "Row limits").

## Consequences

- A host that wraps `sql` without removing the `;` breaks on most replies when it upgrades past `1.0.0-beta.43`. The `@askdb/core` changeset is a minor bump and names the row-cap change.
- The CLI prints `sql` as returned. It used to add a `;` of its own, which would have printed `;;`; a reply without a `;` now prints without one.
- Removing the terminator takes a pattern that can't backtrack. `/\s*;$/` is quadratic on a long whitespace run, which a model reply can contain, so AskDB's own code and the docs use `sql.replace(/;$/, "").trimEnd()` on the trimmed SQL `ask()` returns.
- The consumer lab compares AskDB's SQL with a cassette's without a trailing `;` on either side (#478), so it passes on releases before and after this change.

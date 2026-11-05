# ADR 0030 — Unused public exports leave before 1.0, and engine catalog SQL stays internal

## Status

Accepted (2026-11-05, the coordinating thread's answer to Stop 1 of #275 and #356, Q1 to Q3). Implemented in PR #637.

## Context

1.0 freezes AskDB's public API: after it, removing an export needs a major. The freeze starts with the RC version line (#354).

#356 found five public exports that nothing in the repo calls and no page documents: `formatSchemaForPrompt` (`@askdb/core`), `DEFAULT_LOCAL_POSTGRES_URL` (`@askdb/config`), and `hasAnyColumnDescribable`, `isEnumCandidate` and `parseListInput` (`@askdb/enrich`). Re-running its inventory found a sixth, `@askdb/enrich`'s `formatList`. The plan deprecated them and left the removal to #347 or to #354's 1.0 step. #347 closed without them, and the 1.0 step comes after the freeze.

#275 found that `@askdb/mysql` exported `MYSQL_CATALOG_SQL`, the catalog queries its connector runs. Only the package's own unit test read it, yet every fix to a catalog query became a change to public API (#220 had to say so in its changeset). `@askdb/sqlite` and `@askdb/sqlserver` exported their catalog SQL the same way, with the same comment calling it internal.

`@askdb/postgres` exports `POSTGRES_TEMPLATE_BUNDLE` for a reason the others lack: its from-export mode needs an operator to run those queries by hand in an air-gapped environment, and the connector's `templates()` hands them out.

## Options considered

### Unused public exports

- **A. Remove them in one step before the freeze (chosen).** A minor changeset names each export and its replacement.
- **B. Deprecate now, remove later.** Rejected: it needs a second release and a second PR that no issue owned. If that PR slipped past rc.1, the exports would be frozen until 2.0.

### Engine catalog SQL

- **A. Internal in every engine without a from-export mode (chosen).** MySQL, SQLite and SQL Server stop exporting it; Postgres keeps its template bundle.
- **B. MySQL only, as #275 was filed.** Rejected: SQLite and SQL Server carry the same undocumented export.
- **C. Document every engine's catalog SQL as public, for symmetry.** Rejected: no mode of those engines hands the queries to a person, and every catalog fix would become an API change.

## Decision

- Before 1.0, when AskDB drops a public export that nothing in the repo calls and no page documents, it removes the export in one step. A minor changeset's upgrade notes name the export and its replacement. Which exports to drop is decided one by one (#654). An export that hosts are documented or known to use is deprecated first, as the renamed config keys marked "Removed at 1.0" were (#651).
- An engine package's catalog SQL is internal. It is public only when the engine has a mode that needs a person to run the queries, today `@askdb/postgres`'s from-export mode.
- A unit test reads catalog SQL from its engine's own `connector/describe.ts`, never through the package entry.

## Consequences

- A host that imports a removed name fails to compile or import after it upgrades. The changesets list the replacements, and the upgrade notes (#628) carry them.
- If MySQL, SQLite or SQL Server gains a from-export mode, its catalog SQL becomes public through `templates()`, as Postgres's is.
- This ADR doesn't cover functions exported from a module but used only inside it, such as `escapeSqlLiteralList` in `@askdb/core`. They aren't public, so they can lose `export` at any time (#652).

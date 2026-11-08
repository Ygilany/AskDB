# ADR 0044 — Chart planning sends no rows, and no SQL literals

## Status

Accepted (2026-11-08). The maintainer approved the API in #906's planning round: the experimental `@askdb/client/charts` subpath, three exports with the fallback kept internal, literal masking with core's lexer (option C), and structured output through `generateText` with `Output.object`. They also approved shipping it in rc.1 as an experimental surface, recorded as an amendment to [ADR 0030](0030-1-0-promises-checked-sql-only.md).

## Context

A host that runs AskDB's SQL often wants a chart of the result. Picking one needs intent (what the question asks), and a model reads intent well. A model that sees the rows is the trust surface ADR 0030 puts after 1.0, with roadmap Phase 12's `bounded_results`: consent, sensitive columns projected out, and row and byte budgets. None of that is built.

A chart doesn't need the values. The question gives intent, and the column names and kinds say which columns a chart can use. The SQL helps the model see grouping and ordering, but it carries values of its own: string and number literals from the question, and tenant IDs bound into `ask()`'s `sql`.

## Options considered

### Where the planner lives

- **A. A new 0.x package (`@askdb/charts`).** Rejected by the maintainer: one more package to publish, smoke-test and document, for about 500 lines.
- **B. An experimental subpath of `@askdb/client` (chosen).** `@askdb/client/charts`, like `@askdb/config/scaffold`. Client already has `ai` and `@askdb/core` as peers, so the subpath adds no dependency. The code stays in `packages/client/src/charts/`, imports nothing else in the client, and nothing else in the client imports it, so it can move to its own package as is.
- **C. In `@askdb/core`.** Rejected: core's exports freeze at 1.0, and chart planning isn't checked SQL.

### What the model sees of the SQL

- **A. The SQL as `ask()` returned it.** Rejected: its literals hold values, and its bound form holds tenant IDs.
- **B. No SQL.** Rejected: the model loses the grouping, ordering and aggregation that tell a ranking from a breakdown.
- **C. The SQL with every literal masked (chosen).** Core's `maskSqlLiterals()` replaces strings and numbers with `?` and drops comments, under the readings the tenant check's statement scan uses: the dialect's own for a built-in engine, and every engine's, with both string settings, for any other id or none. A character any reading puts in a literal is masked. If a token never ends, or a literal survives a second read, the model gets no SQL.

### What the model returns

- **A. Chart code (Vega-Lite, a component).** Rejected: code to run, and fields to check inside it.
- **B. A declarative spec (chosen).** A chart type, a category column, series columns, a title and a description, as structured output against a JSON schema (`Output.object` with `jsonSchema()`, no new zod dependency). `ai` 7 no longer exports `generateObject`.

## Decision

- **No rows reach the model.** `classifyResult()` runs in the host process and splits its result into `shape` (column names and kinds, the row count, the truncated flag), the only part the prompt reads, and `local` (negatives, distinct counts, label lengths), which the validator and the fallback read. A test captures the exact prompt the model receives and checks that sentinel row values and SQL literals never appear in it.
- **No SQL literals reach the model.** The planner sends `maskSqlLiterals()`'s output, or no SQL. `maskSqlLiterals` is an internal core export, listed on the core API page with no stability promise.
- **The model returns a declarative spec,** following a fixed rubric: one value gives a metric, time gives a line, part of a whole gives a pie, a ranking gives a horizontal bar, and categories give a bar.
- **`validateChartSpec()` checks every spec:** each column exists, each series is a measure (identifiers and years never are), a chart other than a metric has a category that isn't a measure, a metric is one row and one series, and a pie passes the part-to-whole policy (one additive series across 2–8 distinct categories, no negatives, no time series, no ranking, not truncated).
- **A chart never fails the report.** On a timeout, an abort, a model error or an invalid spec, `planChart()` returns a deterministic pick from the classified columns, with `source: "fallback"` and the reason. The fallback is internal.
- **It is experimental.** A minor release of `@askdb/client` may change `@askdb/client/charts` (ADR 0030's experimental surfaces, ADR 0031's amendment).

## Consequences

- Hosts get a chart without consenting to send data, under any mode: chart planning reads no `mode`, because it sends nothing `schema_only` withholds.
- Column names reach the model, as they do in the NL→SQL prompt. A host that keeps sensitive names out of prompts ([`omitSensitiveIdentifiersFromNlToSqlPrompt`](../contracts/sensitive-fields-and-modes.md)) should know the planner doesn't read that option: the names are the result's own columns.
- A change to the lexer's readings changes what `maskSqlLiterals` masks. It reads through `tenantStatementReadings`, so it follows the tenant check.
- Moving the subpath to its own package is a move of `packages/client/src/charts/` plus a new package entry. Leaving the client then is a breaking change to an experimental surface: a minor.
- Result summaries, which do send rows, still wait for Phase 12 and its consent model. Nothing here sends a row.

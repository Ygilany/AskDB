# ADR 0030 — 1.0 promises checked SQL only

## Status

Accepted (2026-11-05, maintainer decision in the 1.0 planning round, recorded on #354 and in the `1.0.0-rc.1 — public launch` milestone; the experimental surfaces were settled while #631 was planned, and the decision is recorded on #631). Implemented in `docs/mission.md`, `docs/roadmap.md`, `docs/platform.md` and the README status note (#631). Amended 2026-11-06: `@askdb/config/scaffold` joins the experimental surfaces (#711, maintainer decision in its planning round). Amended 2026-11-08: `@askdb/client/charts`, chart planning that sends no rows, joins the experimental surfaces and may ship in rc.1 (#906, maintainer decision in its planning round; [ADR 0044](0044-chart-planning-sends-no-rows.md)). Amended 2026-11-08: the schema artifact format (Schema v2) may still change during the release candidates (maintainer decision Q72, #354).

## Context

`1.0.0-rc.1` freezes the public API, so AskDB has to say what 1.0 promises and which packages it covers before the RC ships. Until #631, the constitution promised more than the code does. `docs/mission.md` promised "schema-grounded SQL and reports", built its north star on executed queries, and listed MCP among the surfaces. The roadmap planned reports and a non-stub `bounded_results` (Phase 12) and an MCP server (Phase 14), with no 1.0 milestone between them and the shipped phases.

The code at the time of the decision:

- `ask()` returns checked SQL. The library, the CLI and the HTTP API never execute it; Studio's optional Playground **Execute** is a local development tool that is off by default ([ADR 0012](0012-sql-checks-are-defense-in-depth.md), `SECURITY.md`).
- `bounded_results` is reserved: it behaves exactly like `schema_only`, with one NL→SQL model call and no row payloads ([`modes-v1.md`](../contracts/modes-v1.md)).
- No first-party MCP server exists. Agents use the CLI, the library or the HTTP API.
- The engine packages cover five engine families (PostgreSQL, MySQL, MariaDB, SQLite, SQL Server), and the consumer lab runs every one, including its tenant suite.
- 5 packages publish on the `1.0.0-beta` line (`askdb`, `@askdb/core`, `@askdb/config`, `@askdb/client`, `@askdb/http-api`); the other 10 publish `0.x` betas.

## Options considered

### A. Reports and result summaries at 1.0

Rejected. They need Phase 12: a non-stub `bounded_results` that sends a bounded subset of the host's rows to a model, with explicit consent, sensitive columns projected out before any summary call, and row, column and byte budgets. None of it is built. It adds a new trust surface, row data reaching a model, and its contract would freeze at 1.0 untested.

### B. An MCP server at 1.0

Rejected. Phase 14 isn't built, and agents already reach the same core and the same SQL checks through the CLI and the HTTP API. Shipping MCP at 1.0 adds a third headless contract to freeze, and it delays the RC without adding a capability agents lack.

### C. Every published package at 1.0

Rejected. Studio, `@askdb/enrich` and `@askdb/rag` are still moving: Studio's authoring flows, the enrichment workspace API, and RAG's embedder and store configuration. At 1.0, each routine change there would need a major version, or the APIs would have to stop changing.

### D. Checked SQL only, with a 1.0 set and a 0.x set (chosen)

1.0 promises what the code does today. Reports, summaries and MCP come later as additions, and the authoring and RAG packages keep room to change.

## Decision

- **1.0 promises checked SQL.** The library, the CLI and the HTTP API return checked SQL and never execute it. Studio's Playground **Execute** stays a local development tool.
- **After 1.0:** reports, result summaries and a non-stub `bounded_results` (roadmap Phase 12), production-grade multi-tenancy (Phase 13), and a first-party MCP server (Phase 14). At 1.0, agents use the CLI and the HTTP API.
- **The 1.0 set** goes to 1.0.0: `@askdb/core`, `@askdb/client`, `@askdb/config`, `@askdb/ai`, `askdb`, `@askdb/http-api`, `@askdb/introspect` and the engine packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`).
- **The 0.x set** stays 0.x: `@askdb/studio`, `@askdb/enrich` and `@askdb/rag`. Their APIs may still move.
- **Experimental surfaces inside the 1.0 set.** These Studio and RAG surfaces follow their 0.x packages. They are experimental, and a minor release of `@askdb/config` or `askdb` may change them:
  - the `studio` and `rag` blocks of `defineConfig` in `@askdb/config`, with the types and environment variables that feed them;
  - the `askdb studio`, `enrich`, `bundle` and `rag` commands;
  - `askdb init`'s `--rag-store`, `--pgvector-env` and `--studio-execute` flags, and the `rag` and `studio` sections it writes;
  - the `@askdb/config/scaffold` entry point: the scaffold planner (config, `.env.example` and install plan) and package-manager helpers that `askdb init` and Studio's setup wizard share (added 2026-11-06, #711);
  - the `@askdb/client/charts` entry point: `classifyResult()`, `planChart()` and `validateChartSpec()`, which plan a chart for a host's query result from the question, the SQL with its literals masked and the result's column names and kinds, never its rows (added 2026-11-08, #906, [ADR 0044](0044-chart-planning-sends-no-rows.md)). It is a step toward reports, not a 1.0 report feature: result summaries and anything else that sends rows stay after 1.0.
- **The schema artifact format isn't frozen at rc.1.** `1.0.0-rc.1` freezes the public API of the 1.0 set, but Schema v2 can still change before 1.0.0 stable. Such a change ships in a release candidate with an upgrade note, and from 1.0.0 a breaking change needs `version: 3` (`docs/contracts/schema-v2.md`). Added 2026-11-08 (maintainer decision Q72, #354).
- **Engines:** all five engine families are supported at 1.0, and the consumer lab covers each one.
- **No fixed date.** rc.1 ships when the `1.0.0-rc.1 — public launch` milestone's gates close.

## Consequences

- After 1.0.0, a breaking change to a package in the 1.0 set needs a major version, unless it is confined to the experimental surfaces above.
- A breaking change to an experimental surface releases `askdb`, `@askdb/config` or, for `@askdb/client/charts`, `@askdb/client` as at least a minor: its changeset names that package `minor`. Without that, Changesets bumps `askdb` only as a patch when a `workspace:*` dependency on Studio, enrich or rag changes (`updateInternalDependencies: "patch"` in `.changeset/config.json`). A fix that leaves a surface working as documented can stay a patch.
- The docs-site reference marks these surfaces experimental (the CLI and configuration pages, and the `@askdb/client/charts` reference and guide). The CLI help and the `@askdb/config` JSDoc don't mark them yet. #662 tracks that.
- Adding reports, a non-stub `bounded_results` or an MCP server after 1.0 is additive: it ships in a 1.x minor and amends this ADR. Moving a 0.x package to 1.0 also amends it.
- `bounded_results` stays in the published modes (`ASKDB_MODES_V1`) as a reserved value, so a host that sets it today keeps working when Phase 12 lands.
- Docs, the README and the docs site must not present reports, result summaries or MCP as 1.0 features.
- A change that makes AskDB execute generated SQL on a supported path beyond Studio's local Playground supersedes this ADR and ADR 0012.
- This ADR doesn't cover CockroachDB: it is a built-in dialect id with no lab coverage, and the dialect wording (#464) records its status.

# ADR 0030 — 1.0 promises checked SQL only

## Status

Accepted (2026-11-05, maintainer decision in the 1.0 planning round, recorded on #354 and in the `1.0.0-rc.1 — public launch` milestone; the experimental surfaces were settled while #631 was planned, and the decision is recorded on #631). Implemented in `docs/mission.md`, `docs/roadmap.md`, `docs/platform.md` and the README status note (#631).

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
  - `askdb init`'s `--rag-store`, `--pgvector-env` and `--studio-execute` flags, and the `rag` and `studio` sections it writes.
- **Engines:** all five engine families are supported at 1.0, and the consumer lab covers each one.
- **No fixed date.** rc.1 ships when the `1.0.0-rc.1 — public launch` milestone's gates close.

## Consequences

- After 1.0.0, a breaking change to a package in the 1.0 set needs a major version, unless it is confined to the experimental surfaces above.
- A breaking change to an experimental surface releases `askdb` or `@askdb/config` as at least a minor: its changeset names that package `minor`. Without that, Changesets bumps `askdb` only as a patch when a `workspace:*` dependency on Studio, enrich or rag changes (`updateInternalDependencies: "patch"` in `.changeset/config.json`). A fix that leaves a surface working as documented can stay a patch.
- The docs-site reference marks these surfaces experimental (the CLI and configuration pages). The CLI help and the `@askdb/config` JSDoc don't mark them yet. #662 tracks that.
- Adding reports, a non-stub `bounded_results` or an MCP server after 1.0 is additive: it ships in a 1.x minor and amends this ADR. Moving a 0.x package to 1.0 also amends it.
- `bounded_results` stays in the published modes (`ASKDB_MODES_V1`) as a reserved value, so a host that sets it today keeps working when Phase 12 lands.
- Docs, the README and the docs site must not present reports, result summaries or MCP as 1.0 features.
- A change that makes AskDB execute generated SQL on a supported path beyond Studio's local Playground supersedes this ADR and ADR 0012.
- This ADR doesn't cover CockroachDB: it is a built-in dialect id with no lab coverage, and the dialect wording (#464) records its status.

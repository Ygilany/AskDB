# Roadmap

High-level implementation order in **small phases**. Each phase should end with something demoable and ideally shippable. Scope expands only after the previous phase is stable.

## Phase 1 ✅ — Schema in, SQL out (CLI), tabular results

Phase 1 ships `@askdb/core` and the `askdb` CLI with AskDB schema JSON v1, BYO-provider NL→SQL plus dev guardrails, optional read-only Postgres execution, tabular results, fixtures/tests, Turborepo, and CI.

**Goal:** Prove the core loop on a single stack.

- Accept **one** schema description format end-to-end.
- **Natural language → SQL** with basic guardrails (validation, safety checks appropriate for local/dev use).
- **Execute** against a configured Postgres instance and return **tabular results** (no rich report builder yet).
- **CLI** as the first surface (fast iteration, no UI coupling).

**Out of scope for Phase 1:** Embeddable UI, **non-Postgres database engines** (see Phase 6), full RAG, sensitive-field registry UI, production-grade multi-tenant policy engine, introspection-query templates (see Phase 5).

## Phase 2 — Hardening and “modes” as contracts

**Goal:** Encode product semantics before more surfaces.

**Spec pack:** [`docs/specs/phase-2-hardening-modes/README.md`](specs/phase-2-hardening-modes/README.md) (links **plan**, **requirements**, **validation** merge bar).

- Introduce **structured logging** and **trace / correlation IDs** across headless surfaces (CLI first; reused by MCP/HTTP later) so integrators can debug and correlate runs—details land with Phase 2/3 wiring, scoped so Phase 1 stays minimal. Rationale: [**ADR 0001 — Structured logging with Pino**](adrs/0001-structured-logging-pino.md).
- Document and implement the **operating modes** (e.g., schema-only execution vs. optional second pass with bounded result data for summaries). Contract: [`docs/contracts/modes-v1.md`](contracts/modes-v1.md).
- Improve SQL validation, explainability, and user prompts when the schema or intent is ambiguous.
- Introduce **sensitive field** handling in metadata (tagged identifiers in NL→SQL DDL by default; optional omission). Longer-term behavior (**bounded_results** summarization with **sensitive columns stripped before any LLM**, post-SQL warnings) lives in [**`docs/contracts/sensitive-fields-and-modes.md`**](contracts/sensitive-fields-and-modes.md).

### Carried forward from Phase 2 (explicit backlog)

These were called out in the Phase 2 [**plan**](specs/phase-2-hardening-modes/plan.md) or [**validation**](specs/phase-2-hardening-modes/validation.md) but are **not** required to consider Phase 2 “done” for merge purposes:

| Item | Where it likely lands |
|------|------------------------|
| **Shrink manual validation** — CI/spawn tests that run `askdb` with `--log-file` / `-v`, assert JSON lines + stable `event` + `correlationId` **without** a live LLM (mock generation or subprocess smoke); optional smoke with secrets only in trusted CI | Near-term hardening (same repo); reduces reliance on [`validation.md`](specs/phase-2-hardening-modes/validation.md) manual steps |
| **Optional `pino-pretty`** for human-readable dev output only (never sole production path per [**ADR 0001**](adrs/0001-structured-logging-pino.md)) | Quality-of-life / DX |
| **`pino.transport()` / worker-thread** logging — only if current multistream file+stderr hits limits | Observability hardening |
| **Richer CLI errors** — reference schema **file path** or fixture hints when parse/validation fails | CLI polish |
| **Post-SQL warnings** — surface host-visible warning when generated SQL references **sensitive**-marked columns ([`sensitive-fields-and-modes.md`](contracts/sensitive-fields-and-modes.md)) | Product trust UX (after NL→SQL ships everywhere) |
| **`bounded_results` non-stub** — optional second model pass with **explicit** consent; **project out sensitive columns** from row payloads before any summary LLM; budgets per [`modes-v1.md`](contracts/modes-v1.md) | **Phase 8** (reports / summaries on execution path) and/or **Phase 3** transport if API exposes summaries first |

## Phase 3 — Second surface (MCP or minimal API)

**Goal:** Meet developers where they work.

- Ship either **MCP** or a small **HTTP API** wrapping the same core as the CLI (choice driven by immediate integration demand).
- Same contracts as Phase 2 so CLI and server stay aligned. Prefer calling **`ask()`** and shared types from `@askdb/core`—see [**`docs/integration/reuse-core-phase-3.md`**](integration/reuse-core-phase-3.md).

## Phase 4 — Web, schema catalog UI, and embed path

**Goal:** First-party app + developer embed story from `mission.md`.

Phase 1 delivered **AskDB schema JSON v1**: a minimal **pure** artifact (physical tables/columns/types/keys) sufficient for the MVP NL→SQL loop. Phase 4 extends that artifact into a **describable schema** that carries the semantic layer the MVP JSON intentionally omitted.

- Next.js app for **web** use cases.
- **No-DB-required path** — Import schema artifacts; work with **describable schema** without mandating a live database connection to AskDB.
- **Enrichment UX** — Turn **pure** imported schema (Phase 1-style JSON) into a **describable schema**: AI surfaces gaps or ambiguities; users interact with the UI (tables, fields) to add **business context**; persist that catalog for **future** NL→SQL and reporting.
- **Semantic fields in the schema artifact** — Evolve the same JSON model (additive fields and/or explicit version bump) so the persisted catalog supports, at minimum:
  - **Table and column descriptions** — Human-readable summaries and richer **business context** (what this entity measures, how it is used).
  - **Aliases / synonyms** — Alternate names NL questions might use (e.g. *clients*, *customers* mapping to the same table or concept) so grounding stays accurate without renaming physical objects.
  - **Optional concept dictionary** — Shared domain terms linked to tables/columns where a single concept should resolve across many names.
- **Generation and embed** — Headless and UI paths read the **merged** physical + semantic metadata when building prompts and validation; the CLI’s pure-schema phase remains the floor, with the web catalog as the place **enrichment** is authored and stored.
- Begin **SDK + embeddable components** for consumers who want AskDB inside their apps (BYO keys; DB optional per workflow).
- **Example application** — Add a **small in-repo example consumer app** to validate the embeddable UI/SDK in realistic integration scenarios (internal dev/QA; not a separate product).

## Phase 5 — User-run introspection queries (schema export)

**Goal:** Turn **Postgres catalog metadata** into an **AskDB schema JSON v1** artifact **without** requiring AskDB to hold DB credentials or open a live connection—unless we add an optional connector later.

**Primary workflow:** Ship **documented `information_schema` SQL** (see [**`docs/specs/postgres-introspection-for-askdb-schema-v1.md`**](specs/postgres-introspection-for-askdb-schema-v1.md)) that users run in **`psql`**, their IDE, or CI; they export rows (CSV/JSON) and pass them to a **converter** that emits **`{ "version": 1, "tables": [...] }`**. Same queries can be unified or split (schemas / tables / columns+PK / FKs) depending on ergonomics.

- Ship **reference queries + mapping notes** to AskDB schema v1 (`type` string, `nullable`, `primaryKey`, multi-schema naming as `schema.table`).
- Ship a **converter** that accepts **exported query results** (format TBD: single unified extract vs. multiple files) and outputs valid AskDB schema JSON v1.
- **Optional later:** a **live introspection** mode (CLI connects with `DATABASE_URL` and runs the same SQL inside AskDB) for teams that want one command—does not replace the air-gapped template path.
- Output remains **importable** into AskDB (aligned with the Phase 4 import path).
- **Postgres-first**; extend alongside **Phase 6** for other engines.

## Phase 6 — Additional databases (beyond Postgres) and schema adapters

**Goal:** Keep Postgres as the proven reference; generalize **carefully** so other engines reach the same bar.

- **Additional SQL database engines** — Beyond PostgreSQL: drivers, **dialect-aware** NL→SQL and validation, execution paths, and regression tests—**one engine at a time** (order driven by demand; no “support everything” lump sum).
- **Schema ingestion** — Additional **schema description formats** as needed, with the same “one format at a time + tests” rule.
- Pair **introspection templates** (Phase 5) with each new engine as it is added.

Early phases intentionally stay **Postgres-only** so execution and guardrails stabilize before we multiply dialects.

## Phase 7 — RAG and intelligence layer

**Goal:** Better retrieval over large schemas and richer grounding.

- Add **RAG** (or equivalent retrieval) for schema and documentation when scale demands it; index and retrieve primarily over the **describable schema** (Phase 4: descriptions, aliases, concepts) layered on physical metadata; keep sensitive-field rules enforced.

## Phase 8 — Reports beyond tables

**Goal:** Full “text to SQL and into reports” promise.

- Structured **report templates** and richer outputs on top of Phase 1’s execution path, still respecting mode and data-boundary rules.

## Phase 9 — Multi-tenant depth

**Goal:** First-class tenant scoping where required.

- Query generation and execution paths enforce **tenant scope** when metadata/policies define it; treat as non-negotiable for supported configurations.

---

Phases may overlap slightly in time (e.g., documentation from Phase 2 alongside Phase 1 bugfixes), but **order should not skip**: each phase builds on a working smaller predecessor.

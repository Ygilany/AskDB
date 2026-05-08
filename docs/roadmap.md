# Roadmap

High-level implementation order in **small phases**. Each phase should end with something demoable and ideally shippable. Scope expands only after the previous phase is stable.

## Phase 1 ✅ — Schema in, SQL out (CLI), tabular results

Phase 1 ships `@askdb/core` and the `askdb` CLI with AskDB schema JSON v1, BYO-provider NL→SQL plus dev guardrails, optional read-only Postgres execution, tabular results, fixtures/tests, Turborepo, and CI.

**Goal:** Prove the core loop on a single stack.

- Accept **one** schema description format end-to-end.
- **Natural language → SQL** with basic guardrails (validation, safety checks appropriate for local/dev use).
- **Execute** against a configured Postgres instance and return **tabular results** (no rich report builder yet).
- **CLI** as the first surface (fast iteration, no UI coupling).

**Out of scope for Phase 1:** Embeddable UI, **non-Postgres database engines** (see Phase 10), full RAG, sensitive-field registry UI, production-grade multi-tenant policy engine, introspection-query templates (see Phase 6).

## Phase 2 ✅ — Hardening and "modes" as contracts

Phase 2 ships modes as explicit contracts, structured logging with correlation IDs, improved SQL validation/explainability, and baseline sensitive-field handling in prompts and docs.

**Goal:** Encode product semantics before more surfaces.

**Spec pack:** [`docs/specs/phase-2-hardening-modes/README.md`](specs/phase-2-hardening-modes/README.md) (links **plan**, **requirements**, **validation** merge bar).

- Introduce **structured logging** and **trace / correlation IDs** across headless surfaces (CLI first; reused by TUI/HTTP/MCP later) so integrators can debug and correlate runs. Rationale: [**ADR 0001 — Structured logging with Pino**](adrs/0001-structured-logging-pino.md).
- Document and implement the **operating modes** (e.g., schema-only execution vs. optional second pass with bounded result data for summaries). Contract: [`docs/contracts/modes-v1.md`](contracts/modes-v1.md).
- Improve SQL validation, explainability, and user prompts when the schema or intent is ambiguous.
- Introduce **sensitive field** handling in metadata (tagged identifiers in NL→SQL DDL by default; optional omission). Longer-term behavior (**bounded_results** summarization with **sensitive columns stripped before any LLM**, post-SQL warnings) lives in [**`docs/contracts/sensitive-fields-and-modes.md`**](contracts/sensitive-fields-and-modes.md).

## Phase 2.5 ✅ — Hardening follow-ups (DX + CI + trust UX)

Completed: CI spawn tests (no live LLM), richer CLI schema-load errors, and sensitive SQL warnings.

**Goal:** Reduce manual validation and tighten the developer + operator experience before introducing more surfaces.

- **Shrink manual validation** — CI/spawn tests that run `askdb` with `--log-file` / `-v`, assert JSON lines + stable `event` + `correlationId` **without** a live LLM.
- **Optional `pino-pretty`** for human-readable dev output only (never sole production path per [**ADR 0001**](adrs/0001-structured-logging-pino.md)).
- **Richer CLI errors** — reference schema **file path** or fixture hints when parse/validation fails.
- **Post-SQL warnings** — surface host-visible warning when generated SQL references **sensitive**-marked columns ([`sensitive-fields-and-modes.md`](contracts/sensitive-fields-and-modes.md)).

## Phase 3 ✅ — HTTP API surface

**Goal:** Meet developers where they work.

Phase 3 ships `@askdb/http-api` as a thin wrapper over `@askdb/core` with the same modes, correlation, and sensitive-field semantics as the CLI.
- Prefer **server-configured schema** (e.g. schema file path/env) over sending schema JSON on every request; allow per-request overrides only for tests/special cases.

**Spec pack:** [`docs/specs/phase-3-http-api/`](specs/phase-3-http-api/).


**Goal:** First-party app + developer embed story from `mission.md`.

- Next.js app for **web** use cases.

Phase 4 delivers **describable schema** semantics (semantic catalog + optional alias/concept metadata) without requiring DB credentials on AskDB. Phase 5 adds the web UI to author, confirm, and save that semantic layer.

- **No-DB-required path** — Import schema artifacts and author the semantic catalog in the web UI without mandating a live database connection to AskDB.
- **Enrichment UX (web catalog)** — AI-assisted enrichment suggestions; users interact with the UI (tables, fields) to add **business context** and semantic fields; persist that catalog for **future** NL→SQL and reporting.
- Web catalog reads/writes the semantic fields produced by Phase 4 and feeds merged metadata into prompt/validation pipelines.
- Begin **SDK + embeddable components** for consumers who want AskDB inside their apps (BYO keys; DB optional per workflow).
- **Example application** — Add a **small in-repo example consumer app** to validate the embeddable UI/SDK in realistic integration scenarios (internal dev/QA; not a separate product).

## Phase 6 — Additional databases (beyond Postgres) and schema adapters

**Goal:** Keep Postgres as the proven reference; generalize **carefully** so other engines reach the same bar.

- **Additional SQL database engines** — Beyond PostgreSQL: drivers, **dialect-aware** NL→SQL and validation, execution paths, and regression tests—**one engine at a time** (order driven by demand; no “support everything” lump sum).
- **Schema ingestion** — Additional **schema description formats** as needed, with the same “one format at a time + tests” rule.
- Pair **introspection templates** (Phase 4) with each new engine as it is added.

Early phases intentionally stay **Postgres-only** so execution and guardrails stabilize before we multiply dialects.

## Phase 7 — RAG and intelligence layer

**Goal:** Better retrieval over large schemas and richer grounding.

- Add **RAG** (or equivalent retrieval) for schema and documentation when scale demands it; index and retrieve primarily over the **describable schema** (Phase 4: descriptions, aliases, concepts) layered on physical metadata; keep sensitive-field rules enforced.
- Add a **schema registry / schemaId** pattern for hosts that need **multiple schemas** (multi-tenant or multi-project), so callers can reference a schema without re-sending it.

## Phase 8 — Reports beyond tables

**Goal:** Full “text to SQL and into reports” promise.

- Structured **report templates** and richer outputs on top of Phase 1’s execution path, still respecting mode and data-boundary rules.
- Make **`bounded_results` non-stub** — optional second model pass with **explicit** consent; **project out sensitive columns** from row payloads before any summary LLM; budgets per [`modes-v1.md`](contracts/modes-v1.md).

## Phase 9 — Multi-tenant depth

**Goal:** First-class tenant scoping where required.

- Query generation and execution paths enforce **tenant scope** when metadata/policies define it; treat as non-negotiable for supported configurations.

## Phase 10 — Second surface follow-on (MCP server)

**Goal:** Meet developers and agents where they work.

- Ship an **MCP** surface (tools/resources) that wraps the same core as the CLI and HTTP API.
- Preserve the same contracts as Phase 2 so CLI, HTTP, and MCP stay aligned (modes, correlation IDs, validation, sensitive-field rules).

---

Phases may overlap slightly in time (e.g., documentation from Phase 2 alongside Phase 1 bugfixes), but **order should not skip**: each phase builds on a working smaller predecessor.

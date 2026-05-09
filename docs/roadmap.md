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

---

## Phase 4 — Publish to npm + BYO executor seam

**Goal:** Turn AskDB into an actually installable package — `pnpm add @askdb/core` from any project, plug in your own database driver and LLM, and call `ask()` from your runtime.

**Spec pack:** [`docs/specs/phase-4-publish-npm/`](specs/phase-4-publish-npm/).

- **Drop `private: true`** on `@askdb/core`, `@askdb/cli`, and `@askdb/http-api`. Pre-1.0 versions; semver applied to the published `index.ts` exports plus the contract docs under `docs/contracts/`.
- **Executor seam** — `ask({ executor })` accepts an integrator-supplied executor function (built-in `pg` Postgres executor remains the default). Decouples `@askdb/core` from `pg` for consumers using postgres.js, Neon HTTP, Hyperdrive, MCP-mediated DBs, etc.
- **Release tooling** — pick and configure (e.g. **changesets**); set up CI publish workflow; add `LICENSE`, package READMEs, examples.
- **Schema format unchanged** — Phase 4 ships the existing pre-v2 format. **Phase 5 makes the breaking change to Schema v2 with no migrator** (acceptable pre-1.0).

## Phase 5 — Schema v2 in `@askdb/core`

**Goal:** Ship the **describable schema** (Schema v2) format inside the published `@askdb/core` so consumers can author and prompt against it without any new package — text editors, CI, and downstream tools all work as soon as Phase 5 lands.

**Contract:** [`docs/contracts/schema-v2.md`](contracts/schema-v2.md).

**Spec pack:** [`docs/specs/phase-5-schema-v2-core/`](specs/phase-5-schema-v2-core/).

- **v2 reader/writer** — Parser, validator, normalizer, and round-trippable writer for the split artifact (physical `schema.json` + describable `tables/*.md` + optional `concepts.md` + bundled JSON form). Stable IDs, sensitive propagation per the contract.
- **Breaking change (pre-1.0)** — Phase 5 makes a clean break from the prior format. The loader accepts only Schema v2 directories or bundled JSON; **no v1 migrator** ships. Pre-1.0 makes this acceptable.
- **Prompt assembly uses v2** — `formatSchemaForNlToSql` (and friends) interleave table descriptions, aliases, and `Common query language` sections into the DDL block when present. Sensitive describable fields are excluded by default per the contract.
- **Hand-authored fixture** — `fixtures/schemas/orders-users.schema/` lands as a hand-authored v2 fixture used by Phase 5/7/8 tests.
- **No TUI in this phase** — Authoring is by hand-editing the markdown front-matter (or by the Phase 7 TUI once it ships). No interactive surface ships in Phase 5.

## Phase 6 — Schema introspection (`@askdb/introspect`)

**Goal:** Turn a real database into a Schema v2 physical artifact through a clean **connector pattern**, with **two equally-supported front doors** (live + air-gapped) that produce identical artifacts.

**Spec pack:** [`docs/specs/phase-6-introspection/`](specs/phase-6-introspection/).

- **`@askdb/introspect` package** — New workspace package. Sub-export per engine: `@askdb/introspect/postgres` ships in this phase; the `Connector` interface is the seam for additional engines in Phase 10.
- **Two front doors, one connector** — Both modes return the same `IntrospectionResult` and write the same artifact:
  - **Live** — `introspect({ executor, ... })` reuses Phase 4's `AskDbExecutor` to run documented `pg_catalog`/`information_schema` queries.
  - **Air-gapped** — `introspect({ bundlePath, ... })` reads exports produced by running the same SQL templates in `psql`/CI/IDE.
- **Determinism** — Catalog queries always include explicit `ORDER BY`. Multi-column foreign keys preserve the constraint's column ordering (regression guard for the documented Drizzle bug). Enum values preserve `pg_enum.enumsortorder`.
- **ID-anchored re-introspection** — On a second run, `schema.json` is the only file rewritten. Stable IDs from the previous run are preserved; new columns get fresh IDs; orphaned IDs surface as `IntrospectionResult.warnings`. The describable layer (`tables/*.md`, `concepts.md`) is **never** modified.
- **CLI surface** — `askdb introspect --url …` and `askdb introspect --from-export …` (also `--print` and `--diff`). Library API mirrors the CLI.

## Phase 7 — TUI enrichment (`@askdb/tui`)

**Goal:** Ship the interactive **terminal authoring surface** that turns a Schema v2 physical artifact (typically introspected in Phase 6) into a fully described one with AI-suggest + human-confirm.

**Contract:** [`docs/contracts/schema-v2.md`](contracts/schema-v2.md).

**Spec pack:** [`docs/specs/phase-7-tui-enrichment/`](specs/phase-7-tui-enrichment/).

- **`@askdb/tui` package** — Interactive terminal app (Clack or Ink) that:
  - Opens an existing Schema v2 directory (introspected via Phase 6, or hand-authored).
  - Walks tables and columns; AI-suggests descriptions and aliases (BYO key); user accepts / edits / rejects.
  - Captures ambiguities as structured prompts ("two columns named `status` — which states?").
  - Writes `tables/<table>.md` files round-trippably (front-matter is YAML; body opaque except H2 anchors).
  - Idempotent — re-opening surfaces orphaned/new column IDs from re-introspection.
- **Optional `bundle` command** — Compiles a v2 directory into a single packed JSON for distribution.
- **No live-DB or migrator paths** — Phase 6 owns introspection; Phase 5 owns the format. The TUI focuses entirely on enrichment.

## Phase 8 — RAG layer (`@askdb/rag`)

**Goal:** Ship retrieval over the describable schema so large schemas don't blow up the prompt and `Common query language` sections actually ground NL→SQL.

**Spec pack:** [`docs/specs/phase-8-rag/`](specs/phase-8-rag/).

- **Chunker** — Deterministic from the v2 artifact per [`schema-v2.md`](contracts/schema-v2.md): table chunks, column chunks, common-query-language chunks, example-question chunks, concept chunks, optional relationship chunks.
- **BYO embedder** — `Embedder = (texts) => Promise<number[][]>` interface; default reference: AI SDK `embedMany()` with `text-embedding-3-small`.
- **BYO vector store** — `VectorStore` interface with adapters added in this order:
  1. **In-memory** (cosine, zero deps) — default for tests and small schemas.
  2. **File-backed** — embeddings serialized next to the schema artifact (`*.embeddings.bin` + `schema.lock.json`); checked-in or shipped artifact.
  3. **pgvector** — most likely production target since users already have Postgres.
- **`ask({ retriever })`** — Optional retriever wired into prompt assembly: when supplied, top-k chunks replace the full DDL block; when omitted, the current behavior is preserved.
- **Sensitive propagation** — Chunker honors v2 sensitive flags per the contract: descriptions/aliases/enum/`Common query language` chunks excluded by default when they reference sensitive columns; logs counts only.

> **Old Phase 7 — superseded.** The earlier "user-run introspection (Postgres → Schema v1 physical)" phase has been replaced by Phase 6 above. The reference SQL queries it documented are still valid and live at [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](specs/postgres-introspection-for-askdb-schema-v1.md) (now flagged superseded); the new Phase 6 spec cites them.

---

## Phase 9 — Web app, schema catalog UI, and embed path

**Goal:** First-party web app + developer embed story. Web catalog is an **alternative authoring surface** for the same Schema v2 artifact, not a prerequisite.

- Next.js app for **web** use cases.
- AI-assisted enrichment UX in the browser; reads/writes the same `schema.json` + `tables/*.md` artifact as the TUI.
- Begin **SDK + embeddable components** for consumers who want AskDB inside their apps (BYO keys; DB optional per workflow).
- **Example application** — Add a small in-repo example consumer app to validate the embeddable UI/SDK in realistic integration scenarios.

## Phase 10 — Additional databases (beyond Postgres) and schema adapters

**Goal:** Keep Postgres as the proven reference; generalize **carefully** so other engines reach the same bar.

- **Additional SQL engines** — Beyond PostgreSQL: drivers, **dialect-aware** NL→SQL and validation, execution paths, and regression tests — **one engine at a time** (order driven by demand; no "support everything" lump sum).
- **Schema ingestion** — Additional schema description formats as needed, with the same "one format at a time + tests" rule.
- Pair **introspection connectors** (Phase 6) with each new engine as it is added — new entries under `@askdb/introspect/<engine>` behind the existing `Connector` interface.

Early phases intentionally stay **Postgres-only** so execution and guardrails stabilize before we multiply dialects.

## Phase 11 — Reports beyond tables

**Goal:** Full "text to SQL and into reports" promise.

- Structured **report templates** and richer outputs on top of Phase 1's execution path, still respecting mode and data-boundary rules.
- Make **`bounded_results` non-stub** — optional second model pass with **explicit** consent; **project out sensitive columns** from row payloads before any summary LLM; budgets per [`modes-v1.md`](contracts/modes-v1.md).

## Phase 12 — Multi-tenant depth

**Goal:** First-class tenant scoping where required.

- Query generation and execution paths enforce **tenant scope** when metadata/policies define it; treat as non-negotiable for supported configurations.

## Phase 13 — MCP server surface

**Goal:** Meet developers and agents where they work.

- Ship an **MCP** surface (tools/resources) that wraps the same core as the CLI and HTTP API.
- Preserve the same contracts as Phase 2 so all surfaces stay aligned (modes, correlation IDs, validation, sensitive-field rules).

---

Phases may overlap slightly in time (e.g., documentation from Phase 6 alongside Phase 7 implementation), but **order should not skip**: each phase builds on a working smaller predecessor.

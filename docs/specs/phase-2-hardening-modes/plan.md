# Plan — Phase 2 (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable**: something you can run, observe, or show without waiting for the full phase to finish. Dependencies flow downward.

## 1 — Observability spine (CLI + core hooks)

### Logging library

- Adopt **[Pino](https://github.com/pinojs/pino)** for structured logs (JSON lines by default). Full rationale: [**ADR 0001**](../../adrs/0001-structured-logging-pino.md); summary table in [**`requirements.md`**](./requirements.md#logging-library-and-destinations).
- Instantiate via a small factory in **`@askdb/core`** (or shared `packages/logger` only if dependency boundaries demand it) so Phase 3 servers reuse the same fields without swapping libraries.

### Configurable destinations

- Support **user-selected log sinks**: at minimum **stderr** (default for interactive CLI so stdout stays clean for tabular/JSON result piping), optional **file path** (append or rotate policy documented), and optional **duplicate** to stdout where integrators want a single stream.
- Wire configuration through **CLI flags and/or environment variables** (exact names TBD in implementation); document in **`README.md`**.
- Use Pino’s **transport** model for multiple targets where needed ([transports](https://github.com/pinojs/pino/blob/master/docs/transports.md)); optional **`pino-pretty`** only for human-readable dev output, never as the only production path.

### Correlation and events

- Define **correlation ID** generation and propagation for a single CLI run (env override optional for integrators).
- Emit structured events for: run start/end, generation, validation, execution branches, mode selection, errors—**stable field names** documented alongside code.
- Ensure output remains **machine-parseable** in CI and local dev (JSON lines; level gates documented).

- **Demo:** (1) Logging enabled to **stderr**: one JSON line per major step sharing the same `correlationId`. (2) Same run with logs directed to a **file** (or second sink): file contains the same structured records—proving destination configuration works.

## 2 — Modes v1 as explicit contracts

- Write **contract doc** (in-repo): mode definitions, what inputs/outputs each allows, what may reach the model, and Postgres execution assumptions unchanged from Phase 1.
- Implement **mode selection** in core (CLI flags/env/config entry) wired into the pipeline before LLM calls and execution.
- Enforce boundaries: e.g. **schema-grounded-only** paths never attach unbounded row payloads to model context; bounded-data modes require explicit limits documented in contract.
- **Demo:** Same NL question under two modes with observable difference in logs and in whether post-execution “summary” paths fire (stub acceptable if summarize step is noop but gated).

## 3 — SQL validation, explainability hooks, ambiguity UX

- Extend validation messages to cite **why** SQL was rejected or flagged (still dev-appropriate guardrails).
- Add **explainability hooks** minimally useful from CLI (e.g. optional `--explain` text or structured snippet) without requiring a GUI.
- Improve **ambiguous schema / intent** handling: deterministic pre-checks, clearer prompts to the model, and clearer CLI errors referencing schema paths or fixtures.
- **Demo:** Fixture-driven scenario for “ambiguous join” or “missing table” yields improved message; optionally show explain output on a validated query.

## 4 — Sensitive-field metadata plumbing

- Extend normalized schema/metadata model with **sensitive** markers on tables/columns (exact representation TBD in implementation; align with roadmap “early plumbing”).
- **Default:** include sensitive **identifiers** in NL→SQL DDL (tagged `(sensitive)`) for grounding; optional **omit** mode for stricter deployments; log at debug with **counts only** (no values).
- **Fixtures**: at least one schema including sensitive columns; tests cover **default include** and **omit** paths.
- **Demo:** Fixture-driven tests showing sensitive columns listed with tags by default; omission mode withholds names when explicitly enabled.

## 5 — Documentation and continuity

- Update **`README.md`** (and/or `docs/roadmap.md` cross-links): modes, logging flags, correlation IDs, sensitive-field schema notes.
- Cross-link [**`requirements.md`**](./requirements.md) and [**`validation.md`**](./validation.md).
- Keep [**`docs/contracts/sensitive-fields-and-modes.md`**](../../contracts/sensitive-fields-and-modes.md) updated as the canonical place for **sensitive metadata vs. NL questions**, optional **names + warning** designs, and **`bounded_results`** row→model stripping rules.
- Confirm Phase 3 readiness: observability fields and mode types are **stable enough** for an MCP or HTTP wrapper to call the same core entrypoints without duplicating policy.

**Implementation locus:** `packages/core`, `packages/cli`, existing `fixtures/` trees, tests; no new Phase 3 transport packages required for Phase 2 merge.

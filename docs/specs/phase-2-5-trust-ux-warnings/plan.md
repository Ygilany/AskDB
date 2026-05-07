# Plan — Phase 2.5 trust UX warnings (demoable milestones)

Numbered groups are ordered so each milestone is demoable and reduces risk early. This phase is intentionally scoped to **DX + CI + trust UX** (no new surfaces).

## 1 — Pin the event taxonomy and log “merge bar” fields

- Identify the minimal set of log fields that are part of the contract for headless surfaces (CLI now; reused later):
  - required: `event`, `correlationId`
  - expected: `level`, time field (`time`/`timestamp`), plus any stable run identifiers already present
- Choose a small, stable set of **events** to assert in CI for a single end-to-end run (avoid overspecifying):
  - run start
  - generation start/end (or equivalent)
  - validation result
  - run end (success/failure)
- Define how CI should capture logs deterministically (prefer file sink) while keeping stdout clean for results.

**Demo:** a local CLI run emits a small, predictable set of events sharing one `correlationId`.

## 2 — Add mock-provider wiring for deterministic E2E CLI runs (no live LLM)

- Add or expose a deterministic provider path for NL→SQL used by tests.
- Ensure it still exercises the real CLI pipeline (args, config, correlation, validation, warning hooks).
- Add fixtures for:
  - a “safe” SQL path (no sensitive columns referenced)
  - a “sensitive referenced” SQL path

**Demo:** `pnpm test` can run a subprocess CLI flow without `OPENAI_API_KEY` and still produce valid logs + SQL.

## 3 — CI spawn tests for structured logs (hard failure on drift)

- Implement spawn tests that:
  - run the CLI with logging directed to a temp file
  - parse JSONL
  - assert required fields exist on every record
  - assert at least one record contains each required event from group 1
- Add a “drift guard” assertion:
  - tests fail if required fields/events are missing or renamed
  - allow additive fields/events without failure

**Demo:** breaking a required log field locally makes the test fail with a clear message.

## 4 — Richer CLI errors (schema path + fixture hints)

- Improve errors for:
  - schema file not found / unreadable
  - schema JSON invalid / wrong shape
  - schema-question precheck failures (unknown table/column, ambiguity)
- Ensure errors are:
  - actionable
  - do not leak sensitive values
  - consistent in exit codes where applicable

**Demo:** intentionally pass a bad schema path and see a helpful error referencing the path and next step.

## 5 — Post-SQL sensitive-column warnings (host-visible)

- Implement warning detection on generated SQL by cross-referencing schema metadata’s sensitive markers.
- Emit:
  - a structured warning event (stable `event`)
  - a human-readable CLI warning (stderr)
- Ensure the warning triggers in both:
  - execution-enabled flows
  - execution-disabled / dry-run flows (warning is about SQL text)

**Demo:** a fixture that references a sensitive column prints a warning and logs the warning event under the run’s `correlationId`.

## 6 — Documentation + polish

- Update any relevant docs (as needed) to document:
  - the CI “no live LLM” test approach
  - what fields/events are considered stable for headless observability
  - how/when sensitive-column warnings appear
- Keep changes minimal and contract-oriented so Phase 3 reuse is straightforward.


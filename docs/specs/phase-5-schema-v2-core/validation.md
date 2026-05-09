# Validation — Phase 5 (Schema v2 in `@askdb/core`) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, the **v2 reader is round-trip tested**, **prompt assembly with v2 fields is golden-tested**, and the **breaking-change rejection** for the pre-v2 format is explicitly tested.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity unchanged).
   - All Phase 1 / 2 / 2.5 / 3 / 4 tests remain green **except** any that loaded the pre-v2 format directly; those are migrated to load the v2 fixture in this phase. The CLI and HTTP API still work end-to-end against the v2 fixture.

2. **Schema v2 reader contract tests** (`packages/core/`)
   - Loader accepts a v2 directory, a bundled JSON, and a path to a `schema.json` inside a directory; returns the unified normalized shape in each case.
   - Loader **rejects** the pre-v2 format input with a structured error pointing at the breaking-change note.
   - **Round-trip:** `parse(write(parse(file)))` equals `parse(file)` for structured front-matter; markdown body bytes preserved verbatim.
   - **ID validation:** unknown front-matter `id` produces an error referencing the offending file; a `tables/<x>.md` whose `id` doesn't appear in `schema.json` produces a stale-id warning.
   - **Front-matter strictness:** unknown keys are errors (typos don't disappear).
   - **Sensitive propagation:** describable-layer fields on sensitive columns are excluded from the normalized representation by default.

3. **Prompt assembly with v2 fields**
   - Golden DDL output for the v2 fixture (`fixtures/schemas/orders-users.schema/`) includes:
     - Table descriptions as comment lines.
     - Aliases inline.
     - `Common query language` blocks per table.
     - Sensitive describable-layer fields **absent** from the prompt.
   - A v2 directory with only `schema.json` (no `tables/*.md`) produces DDL equivalent to the bare-DDL baseline (regression guard).
   - Sensitive identifiers still appear in the DDL tagged `(sensitive)`; the existing `omitSensitiveIdentifiersFromPrompt` flag continues to work.

4. **Bundle round-trip**
   - `bundle` of the v2 fixture produces a single JSON; loading the JSON yields a normalized representation equal to loading the directory. (The `bundle` command itself ships in Phase 7; Phase 5 ensures the loader handles bundled JSON if a hand-authored bundle is present.)

5. **Pack and metadata for `@askdb/core`**
   - `pnpm pack` produces a tarball that includes the new schema parser/writer and excludes test files.
   - `package.json` semver bump (e.g. `0.2.0` pre-1.0) reflects the breaking change; a changeset entry exists.
   - The downstream consumer smoke test from Phase 4 is updated to use the v2 fixture and continues to pass.

## Manual (short)

- In a fresh project, install the freshly published `@askdb/core` version, point it at `fixtures/schemas/orders-users.schema/`, and run `ask()` against a mock model. Confirm the DDL prompt visibly includes descriptions and aliases.
- Hand-edit `tables/orders.md` to add a sentence to the `Business context` section; re-run; confirm only the new sentence appears in the prompt assembly without disturbing other sections.
- Attempt to load a pre-v2 file; confirm the error message names the breaking change and points at the contract doc.

## Non-blockers for Phase 5 merge

- Live Postgres introspection that produces v2 directly (Phase 6).
- Interactive TUI authoring (Phase 7).
- RAG / embedding (Phase 8).
- Web catalog UI authoring against the same artifact (Phase 9).
- Multi-language descriptions / i18n.
- Collaborative editing — Git is the merge story for now.
- Full `bounded_results` summarization.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format contract
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive identifier rules
- [`docs/specs/phase-4-publish-npm/`](../phase-4-publish-npm/) — published `@askdb/core` is the carrier
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — downstream TUI consumer
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — downstream chunker consumer

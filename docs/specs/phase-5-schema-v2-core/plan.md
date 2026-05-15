# Plan — Phase 5 (Schema v2 in `@askdb/core`) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable**. Phase 5 is library-only; no interactive surface ships here.

## 1 — Schema v2 reader

- Implement front-matter validation (zod) and split-artifact loader in `packages/core/src/schema/`:
  - `loadSchema(path)` autodetects between v2 directory, bundled JSON, and a `schema.json` path inside a directory; returns a unified normalized shape.
  - `parseTableMarkdown(content)` extracts front-matter + recognized H2 sections; preserves remaining body verbatim.
  - `parseConceptsMarkdown(content)` extracts the `concepts` front-matter array.
  - Stable-id checks: every front-matter `id` resolves to a `schema.json` id; orphans/missings yield structured warnings.
- The loader **rejects** the pre-v2 format with a clear error referencing the breaking-change note in this phase's `requirements.md` and the contract doc.
- Unit tests cover:
  - v2 directory loaded with mixed described/un-described tables.
  - Bundled JSON loaded.
  - v2 directory with **only** `schema.json` (no `tables/*.md`) loads with empty describable layer.
  - Validation errors: unknown front-matter key, mismatched id, missing `schemaId`, pre-v2 format input.

**Demo:** A test loads `fixtures/schemas/orders-users.schema/` (a hand-authored v2 fixture) and asserts a normalized representation that includes table descriptions and aliases.

## 2 — Schema v2 writer + round-trip

- Implement `writeTableMarkdown(model)` and `writeConceptsMarkdown(model)`:
  - Emit deterministic YAML front-matter (stable key ordering).
  - Preserve markdown body verbatim from the parsed input — the writer touches only front-matter unless explicitly given a body change.
  - Round-trip property: `parse(write(parse(file)))` equals `parse(file)` for the structured fields; body bytes preserved outside any explicit edit.
- Unit tests:
  - Round-trip a fully populated `tables/orders.md` fixture.
  - Round-trip `concepts.md`.
  - Add a new `aliases` entry via the writer; assert only the front-matter line changed in the on-disk diff.

**Demo:** A test reads `tables/orders.md`, writes it back unchanged, and asserts byte-identical output.

## 3 — Prompt assembly uses v2 fields

- Extend `formatSchemaForNlToSql` (and `formatSchemaForPrompt`) in `packages/core/src/schema/normalize.ts` to interleave:
  - Table description as a comment line before each `TABLE <name>`.
  - Aliases inline (e.g. `TABLE orders -- aliases: purchases, sales`).
  - Per-column description appended to the column line.
  - A separate `-- common query language --` block per table when the section is present.
- Sensitive propagation per [`schema-v2.md`](../../contracts/schema-v2.md):
  - Sensitive columns: identifier + type listed; description/aliases/enum **excluded**.
  - Sensitive tables: same as today's existing behavior.
- Add tests:
  - Golden DDL output for the enriched fixture.
  - Sensitive describable-layer fields are excluded from the prompt.
  - A v2 directory with only `schema.json` (no describable layer) produces DDL equivalent to the bare-DDL baseline.

**Demo:** A NL→SQL run on the enriched fixture produces a DDL prompt visibly richer than the un-enriched fixture.

## 4 — Hand-authored v2 fixture

- Create `fixtures/schemas/orders-users.schema/` with:
  - `schema.json` — physical layer with stable IDs covering tables/columns/relationships.
  - `tables/orders.md` and `tables/users.md` — minimally enriched describable layer with descriptions, a couple of aliases, and a small `Common query language` section.
  - Optional `concepts.md` with one cross-table concept (e.g. `concept:customer`).
- The fixture is the input for Phase 5 prompt-assembly tests, the read target for Phase 7 TUI tests, and the chunker source for Phase 8 RAG tests.

**Demo:** `pnpm test` against the fixture produces the golden DDL snapshot from milestone 3.

## 5 — Documentation + first published v2 release

- Update top-level `README.md` and `docs/integration/installable-package.md` with v2 examples:
  - Loading a directory.
  - Loading a bundled JSON.
  - Hand-authoring a minimal `tables/<x>.md`.
- Add a "Schema format" section to `packages/core/README.md` summarizing the v2 layout.
- Add a changeset for the breaking change; bump `@askdb/core` to a pre-1.0 minor (e.g. `0.2.0`) per the Phase 4 release tooling.
- Cross-link Phase 5 spec from `docs/roadmap.md` (already done).

**Demo:** A new contributor follows the README to load `fixtures/schemas/orders-users.schema/` from a fresh consumer project and run `ask()` against a mock model.

---

**Implementation locus:** `packages/core/src/schema/` (parser, validator, writer, prompt assembly), `fixtures/schemas/`, `docs/integration/`, top-level `README.md`. No new packages added in Phase 5; `askdb` and `@askdb/http-api` pick up v2 transparently via the shared `@askdb/core` reader.

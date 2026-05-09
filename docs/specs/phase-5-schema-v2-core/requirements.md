# Phase 5 — Schema v2 in `@askdb/core` (requirements)

Status: Not reviewed

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

The mission frames "schema intelligence" as the gap between **bare DDL** and **good NL→SQL grounding**: descriptions, business context, aliases, and a vocabulary mapping ("sales" = paid orders) need to be **authored once** and **reused** ([`docs/mission.md`](../../mission.md)). Phase 4 published `@askdb/core` to npm with the existing pre-v2 format. Phase 5 makes the **breaking change** to **Schema v2** — the split, RAG-friendly format defined in [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) (physical `schema.json` + describable `tables/*.md` with YAML front-matter + optional `concepts.md`).

Phase 5 is intentionally a **library / contract** phase only. Two follow-on phases consume what lands here:

- **Phase 6** — `@askdb/introspect` turns a real database into a Schema v2 physical artifact. The v2 reader/writer Phase 5 ships is what Phase 6 writes against.
- **Phase 7** — `@askdb/tui` is the interactive enrichment surface. The describable-layer parser/writer Phase 5 ships is what Phase 7 reads and round-trips.

No interactive surface ships in Phase 5; consumers can author the markdown by hand in any text editor (the format is plain markdown + YAML front-matter), or wait for Phase 7.

## Problem

Without Phase 5:

- The published package only understands the pre-v2 format — bare names and types — so NL→SQL grounding is brittle on real schemas.
- There is **no on-disk format** for descriptions, aliases, or "common query language" — these are exactly the highest-value RAG inputs and they have nowhere to live.
- Phases 6 (introspection) and 7 (TUI) cannot land — neither has anything to read or write against until the contract is implemented in core.
- Phase 8 (RAG) has nothing meaningful to chunk; embedding bare DDL is low signal.

## Scope (in)

### 1) Schema v2 reader + writer in `@askdb/core`

Implements the contract in [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md):

- **Loader** — given a path, accepts a v2 directory, a bundled JSON file, or a path to a `schema.json` inside a directory; returns a unified `NormalizedSchema` (extended with describable fields) plus a structured representation of the describable layer. The loader **rejects** the pre-v2 format with a clear error pointing at the breaking-change note in this doc; **no migrator** ships.
- **Front-matter validation** — zod-based; unknown keys are errors (typos don't silently disappear). Markdown body parsed only enough to identify recognized H2 sections (`Common query language`, `Example questions`, `Business context`, `Column notes`).
- **ID enforcement** — every front-matter `id` must match an id in `schema.json`; orphaned ids (deleted columns) and missing ids (new columns) surface as structured warnings.
- **Writer** — round-trippable serializer for `tables/<table>.md` (front-matter + body) and `concepts.md`. Round-trip property: `parse(write(parse(file))) === parse(file)` for the structured fields; body text is preserved verbatim.

### 2) Prompt assembly uses v2 fields

`@askdb/core` prompt construction (`formatSchemaForNlToSql` and friends) reads the describable layer when present:

- Table-level `description`, `aliases`, `primaryEntity`.
- Column-level `description`, `aliases`, `enum`.
- The `Common query language` section appears verbatim in the NL→SQL prompt context, prefixed by table name + aliases for grounding.
- Sensitive propagation matches [`schema-v2.md`](../../contracts/schema-v2.md) (identifiers tagged `(sensitive)` by default; description/aliases/enum excluded for sensitive columns).
- A v2 directory with **only** `schema.json` (no `tables/*.md`) produces DDL with bare names + types — equivalent to the pre-v2 baseline, just sourced from the v2 reader.

### 3) Documentation and fixtures

- `docs/contracts/schema-v2.md` is the canonical reference for this phase's deliverable; cross-link from `@askdb/core`'s `README.md`.
- New hand-authored fixture: `fixtures/schemas/orders-users.schema/` (a v2 directory that mirrors the existing pre-v2 `orders-users` example, minimally enriched with descriptions and aliases) used by Phase 5/7/8 tests.
- Top-level `README.md` and `docs/integration/installable-package.md` updated with v2 examples (load a directory, load a bundle, hand-author a `tables/<x>.md`).

## Out of scope

- **Interactive authoring** — Phase 7 owns the TUI; Phase 5 ships only library APIs and the on-disk contract. Hand-editing markdown is the author flow until Phase 7 lands.
- **Introspection that produces a v2 directory from a live DB** — Phase 6 owns `@askdb/introspect`. Phase 5 does not run any catalog SQL.
- **RAG / embedding** — Phase 8.
- **Web catalog UI** — Phase 9.
- **v1 → v2 migrator** — pre-1.0 we are intentionally not maintaining a backward-compat path; the loader rejects the pre-v2 format with a clear error.
- **Multi-language descriptions / i18n.**
- **Collaborative editing** — Git is the merge story.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| Schema format on disk | **Split artifact** per [`schema-v2.md`](../../contracts/schema-v2.md): JSON for physical, markdown + YAML front-matter for describable. |
| Backward compatibility | **None.** Pre-1.0; the loader rejects the pre-v2 format with a clear error. The `version` literal in `schema.json` stays `2` as a stable marker. |
| Round-trip property | Front-matter is round-trippable; markdown body is preserved verbatim outside of recognized H2 sections being actively edited (the active-edit case is a Phase 7 concern; Phase 5's writer only emits front-matter changes). |
| Sensitive identifier handling | TUI shows non-blocking warnings (Phase 7); for Phase 5 the runtime behavior is: sensitive describable fields excluded from prompt assembly; identifiers tagged `(sensitive)` per the contract. |
| Bundle format | Single packed JSON, **read-only** (authoring stays in the directory). Loader accepts both forms. |
| Hand-authoring | Plain markdown + YAML front-matter is editable in any text editor; this is the **only** authoring path until Phase 7 ships the TUI. |

## Open choices (to resolve during implementation)

- **Loader entry point shape** — single `loadSchema(path)` autodetecting between directory / bundled JSON / direct `schema.json`, vs. explicit `loadSchemaDirectory` / `loadSchemaBundle` helpers. Recommendation: autodetect with explicit helpers exported alongside.
- **Markdown body emit style** — whether the writer enforces a deterministic emit (e.g. always sorted columns in `Column notes`) or preserves user ordering. Recommendation: preserve user ordering on write; only auto-sort front-matter `columns` when adding new ones.
- **Multi-schema Postgres naming in IDs** — confirmed in the contract (`table:public.users`); validate that the loader handles the `.` correctly throughout the parser/normalizer.
- **`schema.lock.json`** — whether to write a stub structure here to reserve the file or defer entirely to Phase 8 (RAG owns embedding checksums). Recommendation: defer to Phase 8.
- **Pre-v2 rejection message** — exact wording (e.g. "AskDB schema format `version: 1` is not supported as of `@askdb/core@0.2.0`; see `docs/contracts/schema-v2.md`").

## Success (product)

After Phase 5:

1. A consumer can `pnpm add @askdb/core` and pass a hand-authored Schema v2 directory to `ask()`; NL→SQL prompts include descriptions, aliases, and `Common query language` sections when present.
2. A consumer with the existing pre-v2 format gets a clear error from the loader pointing at the breaking-change note (no silent fallback).
3. Phase 6 (`@askdb/introspect`) and Phase 7 (`@askdb/tui`) can begin implementation against a stable v2 reader/writer.
4. The split format is round-trippable: write front-matter changes via the writer, re-load — no surprises in the body or unrelated fields.

## References

- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format contract this phase implements
- [`docs/mission.md`](../../mission.md) — describable schema, headless-first authoring
- [`docs/platform.md`](../../platform.md) — package layout, BYO model
- [`docs/roadmap.md`](../../roadmap.md) — Phase 5
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive identifier rules
- [`docs/specs/phase-4-publish-npm/`](../phase-4-publish-npm/) — published `@askdb/core` is the carrier
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — produces v2 directories this phase reads
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — depends on the writer this phase ships
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — consumer of v2 artifacts

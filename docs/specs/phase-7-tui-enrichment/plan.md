# Plan — Phase 7 (TUI enrichment) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable**. The package skeleton lands first; AI-suggest comes after the basic authoring loop is round-trip-tested.

## 1 — `@askdb/tui` package skeleton + library spike

- `packages/tui/` workspace package: `package.json`, ESM, depends on `@askdb/core`, exposes `bin: { "askdb-tui": "./dist/bin.js" }`.
- One-day spike: build the same "edit a table description and save" flow with **`@clack/prompts`** and **`Ink`**; pick the lighter one that hits all of: form-style prompts, list selection with arrow keys, free-text editing for medium-length prose, color-coded sensitive warnings.
- Record the choice in `requirements.md` decisions table; commit the chosen library.

**Demo:** From the spike, a user can `pnpm exec askdb-tui --schema fixtures/schemas/orders-users.schema/` and edit the `orders` description; the file on disk reflects the change with no other diff.

## 2 — Authoring loop: descriptions, aliases, columns

- Implement the table list + per-table form:
  - Table-level: first-paragraph description, aliases (free-form list), `primaryEntity`, tags.
  - Per-column: description, aliases, enum (when type allows), sensitive override.
- Saves write `tables/<name>.md` via the Phase 5 writer with valid front-matter and a markdown body skeleton (`# Table: <name>` + the description as the first paragraph).
- Round-trip on save: re-parse the file and assert no structural changes vs. in-memory model.
- Sensitive-warning UI when a description mentions a sensitive column name (non-blocking).

**Demo:** Walking through 3 tables and saving produces 3 valid `tables/*.md` files; re-opening shows the same content; `@askdb/core` prompt assembly picks them up.

## 3 — AI-suggest with confirm-before-save

- Add a `Suggest` action at every prompt:
  - Calls a small `@askdb/core` helper that builds an enrichment-suggestion prompt (table name, column names, types, neighbor tables) and calls the consumer-supplied `LanguageModel`.
  - Returns 1–3 candidates; user picks / edits / rejects.
- Batch mode (`--auto-suggest-all`):
  - Iterates all empty fields, queues suggestions, surfaces them for review one-at-a-time. Still no auto-save.
- Token-cost guard: print an estimated token count before batch suggest; require confirmation.

**Demo:** With `OPENAI_API_KEY` set, requesting suggestions on `orders` proposes a description, 2–3 aliases, and a `Common query language` block; accepting saves them to the file.

## 4 — Ambiguity capture: "common query language" + example questions

- Free-form text editor for the `Common query language` H2 (multi-line; preserves user formatting).
- Bullet-list editor for `Example questions`.
- Detect cross-table ambiguity (e.g. two `status` columns) and surface as a structured prompt that writes one line into each affected table's `Common query language` section.

**Demo:** Editing `orders` to add 3 mappings ("sales = paid orders", "revenue = sum(...) where paid", "new orders = created in range") writes them into the markdown body under the `Common query language` H2 with no edits to other sections.

## 5 — Concepts + cross-table vocabulary

- Add a "Concepts" tab at the top level: edit `concepts.md` front-matter (id, label, synonyms, links to table/column ids).
- Validate that `links` references exist in `schema.json`.

**Demo:** Adding `concept:customer` linking to `table:users` writes a valid `concepts.md`; loading the schema in `@askdb/core` exposes the concept in the normalized representation.

## 6 — Re-introspection ingestion

- On open, surface the Phase 5 loader's stale-id warnings:
  - **Orphan IDs** (column id present in `tables/<x>.md` front-matter but not in `schema.json`) → offer a one-shot prune action.
  - **New IDs** (column id present in `schema.json` but un-described in `tables/<x>.md`) → queue them for description on next walk.
- Idempotent: re-opening after pruning produces no further prompts.

**Demo:** Run `askdb introspect` (Phase 6) twice with a column added between runs; opening the TUI surfaces the new column as un-described; pruning a removed column erases the orphaned front-matter entry without disturbing the body.

## 7 — Bundle command

- `askdb-tui bundle <schema-dir> --out <bundle.json>` (or `askdb bundle …` shim).
- Compiles the directory into a single packed JSON conforming to the contract.
- Round-trip test: `loadSchema(bundle)` produces the same normalized representation as `loadSchema(directory)`.

**Demo:** `askdb-tui bundle fixtures/schemas/orders-users.schema/` writes a JSON the loader accepts; loading the bundle yields identical prompt output to loading the directory.

## 8 — Documentation + pack

- `packages/tui/README.md` with a 60-second walkthrough beginning at `askdb introspect`.
- Update `docs/integration/installable-package.md` with the canonical `introspect → enrich` flow.
- `pnpm pack` for `@askdb/tui` excluding test files; verify `bin`, `engines`, `repository`, `license`.
- Extend the Phase 4 consumer install smoke to install `@askdb/tui` and run `askdb-tui --version`.

**Demo:** A new contributor can install `@askdb/tui` from a local pack, run the TUI on the fixture, and produce an enriched v2 artifact in under 5 minutes.

---

**Implementation locus:** `packages/tui/` (new package), `fixtures/schemas/`, `docs/integration/`, `packages/cli/` (optional `askdb enrich` shim). No changes to `@askdb/core` or `@askdb/http-api` beyond consuming the existing Phase 5 reader/writer; no changes to `@askdb/introspect` (Phase 6) — the TUI consumes its output but does not invoke it.

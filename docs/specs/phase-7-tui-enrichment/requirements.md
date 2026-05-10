# Phase 7 — TUI enrichment (`@askdb/tui`) (requirements)

Status: Not reviewed

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

Phase 5 ships the **Schema v2** format inside `@askdb/core` — reader, writer, prompt assembly. Phase 6 ships `@askdb/introspect` — turning a real database into a Schema v2 physical artifact through a clean connector pattern with live + air-gapped front doors. By Phase 7, consumers have a way to **get** a v2 directory (introspect or hand-author) and a way to **read** it (core); what they don't have is a way to **enrich** it with descriptions, aliases, and "common query language" without hand-editing markdown front-matter.

Phase 7 closes that gap with **`@askdb/tui`** — the interactive terminal app that authors the describable layer (`tables/*.md`, `concepts.md`) on top of an existing Schema v2 physical artifact, with AI-suggest + human-confirm.

The mission frames "schema intelligence" as the gap between **bare DDL** and **good NL→SQL grounding**: descriptions, business context, aliases, and a vocabulary mapping ("sales" = paid orders) need to be **authored once** and **reused** ([`docs/mission.md`](../../mission.md)). The headless-first SDK pivot makes a TUI the natural first authoring surface — an installable headless package shouldn't require a Next.js app to enrich a schema.

The web catalog (Phase 9) becomes an alternative authoring surface against the same artifact; nothing in Phase 7 blocks that path, but Phase 7 must work entirely without it.

## Problem

Without Phase 7:

- Authoring the describable layer means hand-editing markdown front-matter — fine for a small team but painful at real-schema scale and with no AI assistance.
- The high-value parts of the Schema v2 artifact (`Common query language`, `Example questions`) are either skipped (because hand-authoring is tedious) or inconsistent across tables.
- Re-introspection (Phase 6) surfaces orphaned and new column IDs in `IntrospectionResult.warnings`, but there is no surface that turns those warnings into human action — the TUI is meant to be that surface.
- `@askdb/rag` (Phase 8) chunks an artifact whose describable layer is sparse; signal stays low until enrichment scales.

## Scope (in)

### 1) `@askdb/tui` package

A new workspace package: `packages/tui/`, published as `@askdb/tui`, exposing the binary `askdb-tui` (and discoverable via `askdb enrich` if `@askdb/cli` shells out to it).

**Core flow:**

1. **Open** — `askdb-tui --schema path/to/my-app.schema/`. Input is **always** a Schema v2 directory (or bundled JSON, read-only). The TUI does not introspect; consumers run `askdb introspect` (Phase 6) first or hand-author the directory.
2. **Walk** — table list (left pane) + table detail (right pane). Per table:
   - First-paragraph description prompt.
   - Aliases prompt (free-form list with autocomplete from existing aliases).
   - Per-column description, aliases, enum (when applicable).
   - "Common query language" free-form text area.
   - "Example questions" — bullet list editor.
3. **AI-suggest** — at any prompt, the user can request a suggestion (uses BYO `OPENAI_API_KEY` like the rest of the stack via AI SDK). Suggestions are **proposed**; the user accepts, edits, or rejects. The TUI never auto-saves AI output without confirmation.
4. **Ambiguity capture** — when the LLM detects two columns named `status` (or similar overlap), the TUI surfaces a structured prompt: "Which states does each `status` represent?" with per-table answer slots.
5. **Save** — on save, `tables/<table>.md` is written (or updated) via the Phase 5 writer. The TUI never rewrites unrelated H2 sections — body edits are scoped to the section being edited.
6. **Re-introspection ingestion** — when opening a directory whose `IntrospectionResult.warnings` (from a previous `askdb introspect` run, surfaced via the Phase 5 loader's stale-id warnings) flag orphaned or new column IDs, the TUI prompts the user to **prune** orphans (one-shot) and queues new IDs for description.
7. **Exit and re-enter idempotency** — re-opening shows existing front-matter and body; the TUI does not regenerate or reorder unless asked.

**Stack:**

- TypeScript, ESM.
- Terminal UI library: **decided in implementation** between `@clack/prompts` (lighter) and `Ink` (richer split-pane). Recommendation in `plan.md`.
- BYO model via AI SDK — same `LanguageModel` boundary as `@askdb/core`.
- Depends on `@askdb/core` (Phase 5) for parsing, validation, prompt building (for AI-suggest), and writing.

### 2) `bundle` command

`@askdb/tui` (or a thin shim in `@askdb/cli`) gains a `bundle` subcommand that compiles a v2 directory into a single packed JSON artifact for distribution (`my-app.schema.bundle.json`). The bundle preserves all front-matter, body text, and IDs faithfully. Reading the bundle is supported by the `@askdb/core` loader (Phase 5) as a third input form (alongside v2 directory and `schema.json`).

### 3) Documentation and fixtures

- `packages/tui/README.md` with a 60-second walkthrough.
- `docs/integration/installable-package.md` extended with a TUI quickstart that begins **after** `askdb introspect` (Phase 6) — the canonical flow becomes `introspect → enrich → save`.
- The Phase 5 fixture (`fixtures/schemas/orders-users.schema/`) is the round-trip target for the TUI tests.

## Out of scope

- **Schema v2 reader/writer** — Phase 5; the TUI consumes those APIs.
- **Schema introspection** — Phase 6; the TUI never opens a live DB or runs catalog SQL.
- **RAG / embedding** — Phase 8.
- **Web catalog UX** — Phase 9.
- **Multi-language descriptions / i18n.**
- **Collaborative editing** — single author at a time; Git is the merge story.
- **Full `bounded_results` summarization** or any feature that sends row payloads to an LLM.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| TUI library choice | **Ink** for v0. The implementation uses split-pane table navigation plus editable detail panels, and Ink fits that layout better than a prompt-only flow. |
| AI-suggest gating | **Always confirm** — AI suggestions are proposals, not auto-saves. Even in batch mode (`--auto-suggest-all`), each suggestion is queued for human review before save. |
| Sensitive identifier authoring | TUI shows a non-blocking warning when a description mentions a sensitive column by name, explaining that the chunk will be excluded by `@askdb/rag` (Phase 8). User can save anyway. |
| Bundle format | Single packed JSON, **read-only** for downstream consumers (authoring stays in the directory). The Phase 5 loader accepts both forms. |
| Package locus | `packages/tui/` published as `@askdb/tui`; binary `askdb-tui`. `@askdb/cli` may shell to it via `askdb enrich` (decided in implementation). |
| Input format | Schema v2 directory or bundled JSON (read-only). The TUI does **not** accept a live DB URL — that's Phase 6's job; the canonical flow is `askdb introspect` → `askdb-tui`. |
| Re-introspection ingestion | TUI ingests orphan/new-column warnings from the Phase 5 loader and offers prune/describe actions. |

## Open choices (to resolve during implementation)

- **TUI library** — Clack vs. Ink (decide after a one-day spike comparing developer ergonomics for split-pane and form-style flows).
- **`askdb enrich` command in `@askdb/cli`** — bundle the TUI as a CLI subcommand vs. ship as a separate binary. Recommendation: separate binary for now (`askdb-tui`), with a thin `askdb enrich` shim that spawns it.
- **Multi-schema Postgres naming in IDs** — confirmed in the contract (`table:public.users`); validate that the TUI handles the `.` correctly throughout (the Phase 5 loader is already responsible; this is a UI verification).
- **Markdown body emit style** — whether to enforce a deterministic emit (e.g. always sorted columns in `Column notes`) or preserve user ordering. Recommendation: preserve user ordering; only auto-sort front-matter `columns` when adding new ones (the Phase 5 writer handles this; the TUI just calls it).

## Success (product)

After Phase 7:

1. A consumer can run `askdb introspect --url postgres://...` (Phase 6), then `pnpm dlx @askdb/tui --schema my-app.schema/` (Phase 7), and walk through tables/columns to add descriptions and aliases with AI suggestions BYO via their own API key. Output is a v2 directory ready for `@askdb/rag` (Phase 8) and the web catalog (Phase 9).
2. Re-opening the TUI after another `askdb introspect` run surfaces orphan and new-column IDs as actionable prompts.
3. The split format remains round-trippable: edit front-matter in the TUI, save, re-open — no surprises in the body or unrelated fields.
4. A consumer who skips the TUI (hand-authoring the markdown in their editor) is unaffected — the Phase 5 reader still loads everything.

## References

- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format contract
- [`docs/mission.md`](../../mission.md) — describable schema, headless-first authoring
- [`docs/platform.md`](../../platform.md) — package layout, BYO model
- [`docs/roadmap.md`](../../roadmap.md) — Phase 7
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive identifier rules
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — v2 reader/writer this phase consumes
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — produces the v2 directories the TUI opens
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — consumer of v2 artifacts

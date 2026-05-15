# @askdb/tui

> Interactive terminal authoring surface for AskDB Schema v2 directories.

`@askdb/tui` ships the `askdb-tui` binary, a terminal app that opens a Schema
v2 directory (typically produced by `askdb introspect`) and walks tables and
columns so you can add **descriptions**, **aliases**, and **common query
language** with AI-suggest + human-confirm. The TUI never opens a live
database; it operates on the on-disk artifact only.

## Status

Phase 7 — see [`docs/specs/phase-7-tui-enrichment/`](../../docs/specs/phase-7-tui-enrichment/).
Pre-1.0; the binary surface is stable across patch releases but the contract
will not be frozen until 1.0.

## Quick start

```sh
# 1. Get a Schema v2 directory (Phase 6)
pnpm dlx askdb introspect --url postgres://... --out my-app.schema/ --schema-id my-app

# 2. Enrich it
pnpm dlx @askdb/tui --schema my-app.schema/
```

In the TUI:

- `↑/↓` select a table, `⏎` open it.
- `⏎` edit the active field; `Ctrl-D` submits multiline fields, `Esc` cancels.
- `g` requests an AI suggestion when `OPENAI_API_KEY` is set; accept, edit, or reject before saving.
- `c` opens Concepts from the table list.
- `s` save (writes `tables/<table>.md` via the Phase 5 writer).
- `b` or `Esc` back to the list.
- `q` quit.

Bundle a directory for distribution:

```sh
askdb-tui bundle my-app.schema/ --out my-app.schema.bundle.json
```

The main `askdb` CLI also exposes thin shims when `@askdb/tui` is installed:

```sh
askdb enrich --schema my-app.schema/
askdb bundle my-app.schema/ --out my-app.schema.bundle.json
```

## Output

Saving a table writes `tables/<table>.md` with valid YAML front-matter and a
markdown body. The format contract lives at
[`docs/contracts/schema-v2.md`](../../docs/contracts/schema-v2.md). The Phase 5
writer is the single source of truth for serialization.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

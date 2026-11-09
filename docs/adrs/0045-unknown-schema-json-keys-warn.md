# ADR 0045 — An unknown key in `schema.json` warns, and the load goes on

## Status

Accepted (2026-11-08). The maintainer approved the new `SchemaV2Warning` member on #690 (Q71), on the coordinator's recommendation. Implemented in PR #916: `unknownKeyWarnings` in `packages/core/src/schema/v2/loader.ts`.

## Context

`schema.json`'s zod schemas are non-strict `z.object`s, so a key they don't define was dropped without a word. A misspelled `"sensitve": true` on a column loaded, marked nothing, and left the column unprotected. Table front-matter is stricter: its schemas are `z.strictObject`s, so the same typo there fails the load. The schema v2 contract lets pre-1.0 releases add fields to the physical layer in place, so a `schema.json` written for a newer AskDB can carry keys an older one doesn't know.

## Options considered

- **A. Warn and keep loading (chosen).** A new `SchemaV2Warning` member, `{ kind: "unknown_key", id, key, suggestion? }`, names the key, where it is, and the known key it's closest to. The key is still ignored. `askdb ask`, `askdb bundle` and Studio show it.
- **B. Fail the load,** on every unknown key or only on a near miss of a known one. It catches the typo hardest, but an artifact with a newer additive field would stop loading on an older AskDB, which the contract's additive rule exists to avoid. A near-miss rule would still let other typos through silently.
- **C. Warn and apply the suggested key.** Rejected: guessing which flag the author meant would mark or unmark sensitivity on AskDB's guess; the author fixes the key.
- **D. Keep dropping it silently.** Rejected: that's the defect.

## Decision

`loadSchema()` and `loadSchemaFromJson()` compare each key of `schema.json` as written, at the top level and on every table, column and relationship, with the keys its zod schemas define. Each unknown key is one `unknown_key` warning, in file order, with `id` set to `"schema.json"`, the table's or column's ID, or `<from>-><to>`. `suggestion` is the known key that differs only in case or by at most two edits (one for a key of four letters or fewer). `readSchemaDirectory()` keeps `schema.json` as written in the bundle it returns, unknown keys included, so a directory and its bundle warn alike. Both load to the same schema, built from the parsed physical layer.

## Consequences

- `SchemaV2Warning` gains a member, frozen with the rest of `@askdb/core`'s API at rc.1 (ADR 0030). Code that switches over `kind` exhaustively needs a case.
- A `schema.json` with an extra key, such as an editor's `$schema`, gets one warning per key and still loads.
- A bundle written by `askdb bundle` now carries `schema.json`'s unknown keys.
- The known keys come from the zod shapes, and a test pins the nested levels the check visits, so a new field or nested level can't slip past it.

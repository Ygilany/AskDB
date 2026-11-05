# ADR 0019 — `loadSchema()` fails closed on a stray JSON file in a schema directory

## Status

Accepted (2026-11-04, maintainer decision in the #330 plan round). Implemented in `packages/core/src/schema/v2/loader.ts` (`loadSchema`, `assertNotInSchemaDirectory`).

## Context

`loadSchema(path)` reads a JSON file that isn't a bundle in one of two ways. A file named `schema.json` loads its enclosing directory (since #186), so the sibling `tables/*.md`, `concepts.md` and `tenant-policy.md` apply. Any other JSON file loads as a standalone physical layer, with no sibling files.

That split failed open twice (#330):

- **The name check was case-sensitive.** On macOS and Windows (case-insensitive by default), `Schema.json` opens `schema.json`, but the check missed it. The file loaded standalone, so the tenant policy was dropped and `ask()` stopped requiring a `tenantScope`. Nothing reported an error.
- **Any other name drops the siblings the same way.** `cp schema.json prod-schema.json` and `loadSchema("<dir>/prod-schema.json")` load without the tenant policy, and without every `sensitive: true` escalation in `tables/*.md`.

Matching `schema.json` in any case fixes the first. The second needs a rule for a JSON file that isn't `schema.json` but sits in a schema directory.

## Options considered

### A. Throw when `tenant-policy.md`, `tables/` or `concepts.md` sits beside the file (chosen)

The file is in a schema directory, and loading it alone would ignore files the directory loader reads. `SchemaParseError` names the file and the siblings, and says how to load it: pass the directory, rename the file to `schema.json`, or pass its content to `loadSchemaFromJson()` for only the physical layer. One rule: inside a schema directory, the JSON file must be `schema.json`.

### B. Throw only when `tenant-policy.md` sits beside the file

Rejected. Tenancy stays on, but a `tables/` beside the file still silently drops every front-matter `sensitive: true`, which exposes columns the author marked sensitive.

### C. Throw for `tenant-policy.md` and `tables/`, not `concepts.md`

Rejected. It is as safe as A, but the rule has two parts to explain, and a lone `concepts.md` is still dropped silently. A file in that position is a mistake either way.

### D. Load the file, with a warning in `NormalizedSchemaV2.warnings`

Rejected. Warnings are easy to miss, so tenant enforcement still turns off: the silent fail-open #186 set out to remove.

## Decision

- A path whose basename is `schema.json` in any case loads its enclosing directory, and the physical layer is read from the path given (a file physically named `Schema.json` works on a case-sensitive filesystem too).
- Any other JSON file that isn't a bundle throws `SchemaParseError` when its directory holds `tenant-policy.md`, `tables/` or `concepts.md`, by the exact names the directory loader reads. Only a missing path (`ENOENT`) counts as absent; any other error while checking throws.
- A bundle is self-contained, so it loads wherever it sits.
- A directory path still needs a file named exactly `schema.json`. On a case-sensitive filesystem, a directory holding only `Schema.json` throws, as before.

## Consequences

- A host that loaded a renamed copy of `schema.json` from inside a schema directory now gets an error instead of a schema with no tenant policy. The `@askdb/core` changeset is a minor bump and names the change.
- `loadSchemaFromJson()` remains the way to read only a physical layer, wherever the file sits.
- The check reads the exact sibling names. A wrong-case sibling such as `Tenant-Policy.md` on a case-sensitive filesystem is ignored by the directory loader too; that is #608.

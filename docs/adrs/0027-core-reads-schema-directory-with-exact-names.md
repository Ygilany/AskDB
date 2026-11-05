# ADR 0027 — Core reads a schema directory, and its file names are exact

## Status

Accepted (2026-11-05, the #608 plan round, answered by the coordinating thread on the maintainer's behalf). Implemented in `packages/core/src/schema/v2/loader.ts` (`readSchemaDirectory`, `assertExactNames`). This is the read half of "core owns file access to a schema directory"; [ADR 0028](0028-core-writes-schema-directory-files.md) is the write half (`saveSchemaFile()`). Both amend [ADR 0004](0004-enrichment-package-boundary.md)'s note that core stays out of filesystem work.

## Context

The directory loader read each file by its exact name, and treated a missing file (`ENOENT`) as "no file" (#608):

- **A wrong-case file was skipped where names are case-sensitive.** On Linux, `Tenant-Policy.md` loaded as no tenant policy, so `ask()` stopped requiring a `tenantScope`. On macOS and Windows (case-insensitive by default) the same directory loaded the policy, so a directory that worked on a laptop failed open in a Linux container. `Concepts.md` and `Tables/` were skipped the same way.
- **A wrong-case extension was skipped on every OS.** `tables/*.md` was filtered with `entry.endsWith(".md")`, so `tables/users.MD` was dropped, with every `sensitive: true` in it, on macOS too.
- **ADR 0019's stray-JSON guard checked exact names.** On Linux, `prod-schema.json` beside `Tenant-Policy.md` loaded as a standalone physical layer with no tenant policy.
- **`@askdb/enrich`'s `bundleSchemaDirectory()` copied the read** (#488), so `askdb bundle` left the same files out of the bundle. The copy had already drifted once: before #181 it used `existsSync()` while core treated only `ENOENT` as absent, and an unreadable `tenant-policy.md` produced a bundle with tenant enforcement off.

The decision has two parts: what a wrong-case name does, and where the rule lives.

## Options considered

### What a wrong-case name does

#### A. The names are exact, and a wrong-case name throws on every OS (chosen)

The loader lists the directory once. An entry that matches a name it looks up only when case is ignored (`Tenant-Policy.md`, `Tables`, `tables/users.MD`, `Schema.json` for a directory path) throws `SchemaParseError`, naming each rename. Every OS gives the same result, so the laptop fails the way production would have failed open. A macOS or Windows directory that loads today with a wrong-case name throws until the file is renamed.

#### B. Match every name in any case, and throw only when two spellings exist

Rejected. Linux would load what macOS loads, and nothing would break. But the other readers of a schema directory read exact names: Studio's `loadWorkspace()` and `saveTenantPolicy()`, and `@askdb/rag`'s `loadChunkerSourcesFromDir()`. On Linux they would read different files from `loadSchema()`, and a Studio save would write `tenant-policy.md` beside `Tenant-Policy.md`. Fixing that means changing every reader. Under A they all fail closed through the `loadSchema()` call each already makes.

### Where the rule lives

#### A. Core owns the read: `readSchemaDirectory(dir): BundledSchemaV2` (chosen)

`loadSchema()` and `bundleSchemaDirectory()` both call it, so one function decides which files a schema directory holds. `bundleSchemaDirectory()` keeps its name and package.

#### B. Put the check in both copies

Rejected. Two copies of a tenant-safety rule in two packages is how #181's bundler bug happened.

## Decision

- `readSchemaDirectory(dir)` in `@askdb/core` reads a schema directory into its bundle form. `loadSchema()` reads every directory through it, and `@askdb/enrich`'s `bundleSchemaDirectory()` returns it.
- The names the loader looks up are exact: `schema.json`, `tenant-policy.md`, `concepts.md`, `tables/`, and the `.md` extension in `tables/`. An entry that matches one only when case is ignored throws `SchemaParseError` on every OS. One error names every problem, including the files in a wrong-case `Tables/` (`rename Tenant-Policy.md to tenant-policy.md; rename tables/users.MD to tables/users.md`). Where both spellings exist (only on a case-sensitive filesystem), it says to keep one instead (`keep one of Tenant-Policy.md, tenant-policy.md, named tenant-policy.md`): a rename would overwrite the file, or move `Tables/` inside `tables/` where the loader never looks.
- A path the caller passes is read as given, so `loadSchema("<dir>/Schema.json")` still loads (ADR 0019). Only the names the loader looks up itself are checked. A directory path needs `schema.json` exactly.
- An optional file is absent only when the directory listing doesn't have it. A listed file that can't be read throws, including a symbolic link whose target is missing.
- ADR 0019's stray-JSON guard reads the same listing and counts a sibling in any case, so `prod-schema.json` beside `Tenant-Policy.md` throws on Linux too.
- "Wrong case" means the two names share [ADR 0013](0013-table-filename-scheme.md)'s key, `normalize("NFC").toLowerCase().toUpperCase().toLowerCase()`, which ADR 0013 checked against Unicode full case folding. APFS folds `tableſ` (long s) to `tables`, which `toLowerCase()` alone misses; the stray-JSON guard uses the same key. Other near-misses (`tenant_policy.md`, `.markdown`) are not schema files and are ignored.

## Consequences

- A directory with a wrong-case name now throws on macOS and Windows, where it loaded before. The `@askdb/core` changeset is a minor bump and names the change. The fix is a rename.
- `askdb bundle`, Studio (through `loadWorkspace()`'s `loadSchema()` call) and `@askdb/rag`'s directory loader refuse the same directories `loadSchema()` refuses.
- `@askdb/core` gains a public export, `readSchemaDirectory()`. A host can build a bundle without `@askdb/enrich`.
- A new optional file goes in `SCHEMA_DIRECTORY_FILES`, which `satisfies` keeps in step with `BundledSchemaV2`. The name check, the read, the bundle loader and the stray-JSON guard all read that list.
- Studio's `loadWorkspace()` still reads `tables/*.md` and `concepts.md` itself, for authoring state. Moving it onto `readSchemaDirectory()` is a separate change.

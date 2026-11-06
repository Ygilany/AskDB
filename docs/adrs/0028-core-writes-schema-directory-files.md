# ADR 0028 — Core writes a file into a schema directory, and no link redirects it

## Status

Accepted (2026-11-05, the #617 plan round, answered by the coordinating thread on the maintainer's behalf). Implemented in `packages/core/src/schema/v2/save-file.ts` (`saveSchemaFile`). This is the write half of "core owns file access to a schema directory"; [ADR 0027](0027-core-reads-schema-directory-with-exact-names.md) is the read half (`readSchemaDirectory()`). Both amend [ADR 0004](0004-enrichment-package-boundary.md)'s note that core stays out of filesystem work. The write rules themselves are [ADR 0013](0013-table-filename-scheme.md)'s "Writes are also contained".

## Context

#372 (PR #618) made every `@askdb/enrich` save into a schema directory (`tables/*.md`, `concepts.md`, `tenant-policy.md`) refuse a symbolic link and write through a temp file renamed over the target. The rules lived in one helper, internal to `@askdb/enrich`.

Three other writers into the same directory still used `writeFileSync` or `appendFileSync`, so a symbolic link at the file made them write to whatever it pointed at (#617):

- **`playground-history.json`**: Studio's history append, on every Playground generate, and its history delete.
- **`.gitignore`**: Studio's update before the first history write. A dangling link was followed too: the write created the file the link named.
- **`schema.json`**: `@askdb/introspect`'s `renderToSchemaV2()`, which `askdb introspect --out` and Studio's **Resync schema** call.

A schema directory can come from an untrusted checkout, and git stores symbolic links. Studio's request guard ([ADR 0009](0009-studio-local-api-protection.md)) limits who can trigger these writes, so this is defense in depth. It still broke the promise that Studio writes only inside the schema directory.

The writers sit in Studio and `@askdb/introspect`. Introspect doesn't depend on `@askdb/enrich`: the only package the two share is `@askdb/core`.

## Options considered

### A. Core owns the write: `saveSchemaFile(schemaDir, relativePath, content)` (chosen)

The helper moves to `@askdb/core` as a public, documented export, and every writer calls it. One copy holds the rules, and a custom authoring surface gets the same guarantee. Core gains one function. Since callers outside AskDB pass it paths, it must check `relativePath` itself instead of trusting the caller.

### B. Export it from `@askdb/enrich`, and make introspect depend on enrich

Rejected. Every engine package depends on `@askdb/introspect`, so each one would install the authoring package to write one file. Introspect would sit on top of the authoring layer instead of beside it.

### C. Export it from `@askdb/enrich` for Studio, and give introspect its own temp-file-plus-rename write

Rejected. Two copies of a safety rule in two packages drift: #181's bundler bug and #608 both failed open that way.

### D. Put it in `@askdb/introspect/kit`

Rejected. `@askdb/enrich` would have to depend on `@askdb/introspect`, and the kit holds building blocks for engine packages, not file writes.

## Decision

- `saveSchemaFile(schemaDir, relativePath, content)` in `@askdb/core` writes a file into a schema directory. `content` is a string, written as UTF-8, or bytes, written as given. These writers call it: `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` in `@askdb/enrich`; Studio's Playground history (append and delete) and its `.gitignore` update; and `renderToSchemaV2()` in `@askdb/introspect`.
- Its rules are ADR 0013's. It refuses a symbolic link at the file, or at any directory between the file and the schema directory. The schema directory itself may be a link. It writes a new temp file next to the target, with the target's owner, group and permission bits, `fsync`s it and renames it over the target. A target the caller can't write is refused with `EACCES`.
- `relativePath` uses `/` between parts. A path with an empty, `.` or `..` part, a NUL byte, or (on Windows) `\` in a part is refused. So is an absolute path, whose first part is empty. Missing directories are not created.
- A change to part of a file is a read, then a save of the whole file through the helper. There is no append variant: Studio's `.gitignore` update reads the file's bytes, adds its entry and saves the result, so a non-UTF-8 file name in an existing line survives.
- A refusal reads `Refusing to write <relativePath> outside the schema directory: <why>`.
- Reads don't change: reading a file still follows a link. ADR 0027 decides which files are read.
- In Studio, a refused history write fails the request (`500`, with the refusal message). A refused `.gitignore` write stays non-fatal, as every `.gitignore` failure was before: the history still saves.

## Consequences

- `@askdb/core` gains a public export, `saveSchemaFile()` (minor changeset). `renderToSchemaV2()` now throws on a linked `schema.json`, so `askdb introspect --out` and **Resync schema** fail instead of writing through it (minor changeset for `@askdb/introspect`). The fix is to replace the link with a regular file.
- `schema.json`, `playground-history.json` and `.gitignore` are now replaced by a rename, not written in place. A hard link at one of them is detached, not written through. Each write now needs write access to the schema directory for the temp file. On Windows, the rename fails with `EPERM` while another process holds the file open without delete sharing (ADR 0013's consequence, now for these files too).
- During a write, a `.askdb-save-<hex>.tmp` file exists for a moment in the target's directory. The loader reads only the names it looks up (ADR 0027), so it ignores the file.
- The link-refusal messages from `@askdb/enrich`'s saves change text: a table save now says `tables/<file>.md outside the schema directory`, not `table markdown outside tables/`. Enrich's own check on a table filename keeps its message.
- `@askdb/rag`'s `writeLockFile()` (`schema.lock.json`) and its file store's flush stay as they are. Each takes a full path, not a path inside a schema directory, and already writes a temp file and renames it over the target, so a link at the target is replaced, not followed.
- The new file keeps the target's mode bits, owner and group, but not its access control list (ACL) or other extended attributes: Node has no API for them. On macOS a `deny` entry is dropped. On Linux, the group bits of a file with a POSIX ACL are its mask, so a save can give the owning group access the ACL denied it. A directory's default ACL still applies to the new file. This holds for every save since ADR 0013, and now for `schema.json`, `playground-history.json` and `.gitignore`, which were written in place before. #659 tracks whether to do more.
- A new writer into a schema directory calls `saveSchemaFile()`. Not covered, as in ADR 0013: a directory between the schema directory and the target (`tables/`) swapped for a link during a save.

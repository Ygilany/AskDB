# ADR 0013 — Default filenames for `tables/*.md`

## Status

Accepted (2026-09-29). Implemented by PR #181 (`assignDefaultTableFilenames()` in `packages/enrich/src/workspace.ts`).

## Context

A Schema v2 directory has one optional markdown file per described table under `tables/` ([schema-v2 contract](../contracts/schema-v2.md#describable-layer--tablestablemd)). The loader pairs a file with its table by the front-matter `id`, never by filename, so any filename works once a file exists.

`@askdb/enrich` still has to pick a name when it creates a file for a table that has none yet (`loadWorkspace()` assigns it and `saveTable()` writes it). Studio and custom authoring surfaces all go through that code. Before PR #181 the name was `${table.name}.md`, which broke in three ways:

- **Collisions.** `public.orders` and `archive.orders` both mapped to `orders.md`, so saving one overwrote the other. Names that differ only in case (`Orders`, `orders`) collide the same way on a case-insensitive file system. So do names that differ only in Unicode normalization or case folding: APFS stores NFC `café` and NFD `café` as one file, and `straße` and `STRASSE` as one file. Postgres and SQL Server treat each of these pairs as two distinct quoted identifiers.
- **Escapes.** A quoted identifier such as `../../x` made the write land outside `tables/`.
- **Length.** SQL Server allows 128-character identifiers. A schema-qualified name can then be 260 bytes, and 128 CJK characters are 384 bytes even unqualified. ext4 and APFS cap one name at 255 UTF-8 bytes and NTFS at 255 UTF-16 units, so the write fails with `ENAMETOOLONG`.

The name only has to be unique, stay inside `tables/`, and fit on disk. Readability matters too: people open these files in an editor and review them in pull requests, and every existing fixture and doc uses `<table>.md`.

## Options considered

### A. Bare name, schema-qualified on collision, counter as last resort (chosen)

`<table>.md` when no other table in `schema.json` has the same name; otherwise `<schema>.<table>.md`; `<schema>.<table>-<n>.md` if that is taken too. A name already on disk, including an orphaned file, is never reused.

- Single-schema databases, the common case, keep the short names every fixture and doc already uses.
- Two same-named tables in different schemas get names that say which is which.
- A table's name depends on the rest of the schema (see Consequences).

### B. Always `<schema>.<table>.md`

Simple and stable: a table's filename depends only on its own identifier.

- Every file in a single-schema Postgres database becomes `public.<table>.md`, and so does every SQLite file, since AskDB's SQLite introspection puts tables in `public`. That is noise in the common case.
- Existing directories would mix `orders.md` (existing, kept) with `public.users.md` (new).
- Still needs a collision rule for case and Unicode folding (`public.Orders` against `public.orders`), so it doesn't remove the counter.

### C. Reversible encoding of the identifier

Percent-encode or escape every character outside a safe set, so the filename decodes back to `schema.table`.

- Unique by construction and never ambiguous.
- Unreadable for non-ASCII names (`caf%C3%A9.md`) and for common punctuation.
- Case-insensitive file systems still merge `Orders` and `orders` unless case is encoded too, which makes every name harder to read.
- Nothing needs to decode a filename: pairing is by front-matter `id`.

### D. Hash suffix on every name

`orders-3f9a1c2e.md`: unique without looking at other tables.

- Every filename carries noise, and a reviewer can't tell from the name alone which schema a file belongs to.
- Readable names would only appear in the front-matter.

### E. Counter only

`orders.md`, then `orders-2.md`.

- Short, but `orders-2.md` doesn't say which schema it is, and which table gets the counter depends on `schema.json` order.

## Decision

Option A, with three rules that apply to every candidate name:

1. **Filename-safe slug.** Path separators, NUL, control characters, lone UTF-16 surrogates (which Node writes to a path as U+FFFD, so `a\ud800` and `a\ud801` would be one file) and Windows-reserved characters become `_`. A leading `.` (which also covers `.` and `..`) or a Windows device name (`CON`, `LPT1`, …) gets a `_` prefix. Trailing dots and spaces become `_`.
2. **File-system comparison.** "Same name" and "already on disk" are decided with the key `name.normalize("NFC").toLowerCase().toUpperCase().toLowerCase()`. "Already on disk" counts every entry in `tables/`, not only the `.md` files the loader reads, so `Orders.MD` blocks `orders.md`. APFS compares names after normalization and with full case folding. NTFS compares with a per-character uppercase table and doesn't normalize. NFC removes normalization differences. Lowercasing first maps capital sharp s `ẞ` (U+1E9E) to `ß`, and the uppercase step then applies the expanding mappings (`ß` → `SS`) that plain `toLowerCase()` skips. How it was checked: every assigned code point up to U+2FFFF was grouped by Unicode full case folding (Python's `NFD(casefold(NFD(c)))`, Unicode 15.1), which gives 2335 groups of two or more characters, and the key was computed for each member with Node's case mapping. Every group gets exactly one key. The earlier key without the first `toLowerCase()` split one group, `{ß, ẞ}`. In the other direction the key merges exactly one pair that full case folding keeps apart, dotless `ı` and `i`, which only costs a qualified name. NTFS's per-character uppercase equality is also covered: no character's key differs from the key of its uppercase where that is a single character. This is a check over single code points, not a proof for every string, and it depends on the Unicode version of the Node runtime. The key doesn't depend on the host OS, so a directory gets the same names on Linux, macOS and Windows. Over-matching only costs a longer, qualified name.
3. **Length.** A name longer than 200 bytes, counted as UTF-8 bytes of its NFD form, is cut at a code-point boundary and ends in `~` plus the first 8 hex digits of SHA-256 of the untruncated name. That count is never less than the length any common file system limits: UTF-8 bytes (ext4, APFS), UTF-16 units (NTFS) and decomposed UTF-16 units (HFS+), all capped at 255. The margin leaves room for editor and atomic-write temp names such as `.orders.md.swp`. The hash keeps two long names with the same prefix apart, and the "already taken" check still applies after truncation.

For over-long names we considered failing with a clear error instead of truncating. We rejected it: the table name comes from the database, so the user can't fix it, and a schema with such a table could never be enriched. Truncation costs nothing that matters, because nothing reads a table's identity from its filename.

Writes are also contained: `saveTable()` refuses a filename that isn't a plain `.md` name directly inside `tables/` (`\` counts as a separator only on Windows, so an existing `ord\ers.md` still saves on macOS and Linux), and refuses to write when `tables/` or the target file is a symbolic link. It writes the content to a new temp file in `tables/` and renames that over the target, so a hard link at the target is replaced rather than written through, and the save is atomic. We chose the rename over refusing files with more than one hard link: it also replaces a symbolic link planted between the check and the write instead of following it (including on Windows, which has no `O_NOFOLLOW`), and it never leaves a half-written file: the temp file gets the target's owner, group and permission bits before any content is written and is `fsync`ed before the rename, so a crash or power loss leaves the old file or the new one. Only root can give a file to another user, so a save by a group member who isn't the owner makes the saver the owner; if the process can't set the target's group either, the group and others each get only the access both had, so the group the new file lands in gains nothing. Because `rename` needs only write access to `tables/`, `saveTable()` first checks that the target itself is writable and throws `EACCES` if it isn't, as a plain write did, so a read-only file (how Perforce and ClearCase mark files that aren't checked out) is never replaced. The one gap left is `tables/` itself being swapped for a link during a save. This is a safety rule rather than part of the naming choice; it is recorded here because the contract states both together.

## Consequences

- **A table's filename depends on which tables existed when its file was first created.** Created alone, `public.orders` gets `orders.md`. Created in the same pass as `archive.orders`, it gets `public.orders.md`. If `archive.orders` appears later, `public.orders` keeps `orders.md` (existing files are never renamed) and only the new table is qualified. Two directories for the same database can therefore name the same table differently. Tools must pair files with tables by front-matter `id`, never by computing a filename from a table id.
- On Windows, replacing a file by rename fails with `EPERM` while another process holds the target open without delete sharing: antivirus scanners, search indexers, sync clients and some editors do this briefly. A save can then fail where an in-place write would have succeeded; saving again usually works. `saveTable()` doesn't retry.
- Among names that fold to the same key within one schema (`public.Orders`, `public.orders`), the table listed first in `schema.json` gets the name without a counter.
- Existing files keep their names, so no migration is needed. Directories written before PR #181 may still hold a single `orders.md` that one of two same-named tables overwrote; that loss happened at write time and can't be detected afterwards.
- Truncated names can't be read back to the identifier. That is acceptable because pairing is by `id`, and the file's front-matter and `# Table:` heading carry the full name.
- The rules live only in `@askdb/enrich` (ADR 0004). Studio and the CLI don't pick filenames.
- The comparison key and the 200-byte limit are part of the documented contract. Changing either can rename the default for tables that don't have a file yet (never an existing file), so it needs an amendment to this ADR.

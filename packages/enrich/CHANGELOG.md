# @askdb/enrich

## 0.2.0-beta.21

### Minor Changes

- 3b77292: `bundleSchemaDirectory()` checks the bundle it reads with `@askdb/core`'s loader, and throws the loader's `SchemaParseError` for a directory `loadSchema()` refuses, where it returned a bundle that didn't load (#796). That covers front-matter that isn't YAML, a tenant policy that doesn't parse or doesn't fit `schema.json`, and two table files with the same `id`. The error names the file on disk. A bundle it returns always loads.

### Patch Changes

- Updated dependencies [88fe1c3]
- Updated dependencies [c501c5b]
- Updated dependencies [4b7f0d3]
- Updated dependencies [3797a5a]
- Updated dependencies [df612e9]
- Updated dependencies [42f9078]
- Updated dependencies [659cb75]
- Updated dependencies [7c00370]
- Updated dependencies [6ea4e72]
- Updated dependencies [ca606c2]
- Updated dependencies [dfc3716]
- Updated dependencies [a0d2ec2]
- Updated dependencies [1b9468d]
- Updated dependencies [91e89ec]
  - @askdb/core@1.0.0-beta.50

## 0.2.0-beta.20

### Patch Changes

- Updated dependencies [ca816cc]
- Updated dependencies [29a0fc1]
- Updated dependencies [396ad23]
- Updated dependencies [4437394]
  - @askdb/core@1.0.0-beta.49

## 0.2.0-beta.19

### Patch Changes

- c28c967: Declare `ai` as a peer, with the range `@askdb/core` requires (`^6.0.0 || ^7.0.51`), so Yarn Plug'n'Play passes your app's `ai` through to `@askdb/core` (#748). Before, core inside these packages couldn't reach `ai` under Plug'n'Play, and `yarn dlx askdb` crashed at startup. Core already required `ai` when it loads, so npm and pnpm install nothing new, and a host that already meets core's `ai` range meets this one.
- Updated dependencies [294ef92]
- Updated dependencies [f8f99cb]
- Updated dependencies [180f28a]
- Updated dependencies [9e49e34]
- Updated dependencies [b52a89f]
- Updated dependencies [229a592]
  - @askdb/core@1.0.0-beta.48

## 0.2.0-beta.18

### Patch Changes

- Updated dependencies [f4e60a9]
- Updated dependencies [80c7ddf]
- Updated dependencies [0a94c6f]
- Updated dependencies [4f322db]
- Updated dependencies [4365d4c]
  - @askdb/core@1.0.0-beta.47

## 0.2.0-beta.17

### Minor Changes

- 234eec0: - **A wrong-case schema file name throws instead of being skipped.** `loadSchema()` now throws `SchemaParseError` when a schema directory holds `Tenant-Policy.md`, `Concepts.md`, `Tables/`, `tables/<name>.MD`, or (for a directory path) `Schema.json`. The error names each rename, for example `rename Tenant-Policy.md to tenant-policy.md`, or says to keep one when both spellings exist (possible only on Linux). Before, on Linux (case-sensitive), the loader skipped those files: a skipped `tenant-policy.md` loaded the schema with no tenant policy, so `ask()` stopped requiring a `tenantScope`, and nothing reported an error. A `tables/*.MD` file was skipped on every OS, with every `sensitive: true` in it. The check runs on every OS, so a directory that loaded on macOS or Windows with a wrong-case name now throws there too. Rename the file to fix it. A path you pass is still read as given, so `loadSchema("<dir>/Schema.json")` loads as before. See ADR 0027.
  - **An optional file is absent only when the directory doesn't list it.** A listed `tenant-policy.md`, `concepts.md`, `tables/` or table file that can't be read now throws, including a symbolic link whose target is missing, which used to load as "no file".
  - **The stray-JSON check counts a sibling in any case.** On Linux, `loadSchema("<dir>/prod-schema.json")` beside `Tenant-Policy.md` loaded with no tenant policy. It now throws, as it already did beside `tenant-policy.md` (ADR 0019).
  - **New `readSchemaDirectory(dir)`** in `@askdb/core` reads a schema directory into its `BundledSchemaV2` bundle form. `loadSchema()` reads every directory through it.
  - **`@askdb/enrich`'s `bundleSchemaDirectory()` returns `readSchemaDirectory()`**, so `askdb bundle` refuses the same directories `loadSchema()` refuses, instead of writing a bundle without a wrong-case `Tenant-Policy.md`. Its errors are now `SchemaParseError`s from core, where a failed read used to throw the raw Node error. `loadWorkspace()` (Studio) refuses such a directory too, through its `loadSchema()` call. Minor: these directories used to be accepted.
  - Docs: the core API reference covers `readSchemaDirectory()` and the exact-name rule; troubleshooting covers the new error; the CLI reference notes that `askdb bundle` refuses such a directory.
- ed7f35c: Remove public exports that nothing in AskDB calls and no page documents, before the 1.0 API freeze (#356, ADR 0031).
  
  **Upgrade notes (breaking):**
  
  - `@askdb/core`: `formatSchemaForPrompt(schema, options)` is removed. Call `formatSchemaForNlToSql(schema, options).ddl`, which returns the same string.
  - `@askdb/config`: `DEFAULT_LOCAL_POSTGRES_URL` is removed, with no replacement. Write your own local connection string.
  - `@askdb/enrich`: `hasAnyColumnDescribable`, `isEnumCandidate`, `parseListInput` and `formatList` are removed, with no replacement. In place of `parseListInput(value)`, use `value.split(",").map((s) => s.trim()).filter(Boolean)`; in place of `formatList(list)`, use `list?.join(", ") ?? ""`.
  
  Internal cleanup with no API change: core's tenant-policy loader drops two unused helpers, and Studio's web app drops the unused `Drawer` and `Panel` components, the Drawer CSS and four unused formatting helpers.

### Patch Changes

- f3decbb: Every AskDB write into a schema directory now refuses symbolic links (#617, ADR 0028).
  
  - New `@askdb/core` export: `saveSchemaFile(schemaDir, relativePath, content)` writes one file inside a schema directory; `content` is a string (written as UTF-8) or a `Uint8Array`. It refuses a symbolic link at the file or at a directory between it and the schema directory (such as `tables/`), and a `relativePath` with an empty, `.` or `..` part or a NUL byte. It writes a temp file next to the target, with the target's permission bits, group and, where allowed, owner, and renames it over the target, so a hard link is replaced instead of written through and the write is atomic. A read-only target is refused with `EACCES`. The schema directory itself may be a symbolic link. This is the helper `@askdb/enrich`'s saves used since #372, moved to core so every writer shares it.
  - `@askdb/introspect`: `renderToSchemaV2()`, and so `introspect()` with render options, writes `schema.json` through `saveSchemaFile()`. A `schema.json` that is a symbolic link now throws `Refusing to write schema.json outside the schema directory: "schema.json" is a symbolic link`. Before, the write went to the file the link pointed at.
  - `askdb`: `askdb introspect --out` fails the same way on a linked `schema.json`.
  - `@askdb/studio`: Playground history (`playground-history.json`, saved on every generate and on delete) and the `.gitignore` entry Studio adds for it are written through `saveSchemaFile()`, and so is `schema.json` on **Resync schema**. A linked history file fails the request with the refusal message. A linked `.gitignore` is left as it is and the history still saves, as with any `.gitignore` failure before. A dangling link at `.gitignore` no longer creates the file it names. The `.gitignore` update keeps the existing file's bytes, so a non-UTF-8 file name in it survives.
  - `@askdb/enrich`: `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` call core's `saveSchemaFile()`; the behavior is unchanged. The refusal for a table now reads `Refusing to write tables/orders.md outside the schema directory: …` instead of `Refusing to write table markdown outside tables/: …`. The check on a table filename keeps its message.
  
  **Upgrade notes:**
  
  - `renderToSchemaV2()`, `introspect()` with render options, and `askdb introspect --out` throw when `schema.json` in the output directory is a symbolic link. Replace the link with a regular file.
  - Writing `schema.json` now needs write access to the output directory for the temp file, and a hard link at `schema.json` is replaced instead of written through. The new file keeps the old one's mode bits, owner and group, but not an access control list (#659). On Windows, the rename fails with `EPERM` while another process holds `schema.json` open; running again usually works.
- 7ca1940: A tenant policy that doesn't match `schema.json` now fails the load under `enforcement: strict`, and is reported under `warn` (ADR 0023, #332).
  
  `loadSchema()` and `loadSchemaFromJson()` check every ID in `tenant-policy.md` against `schema.json`. Under `strict`, an orphaned column or foreign key ID, a hierarchy cycle, or a root named in `parent`, `hierarchy`, `scopeThrough` or a polymorphic `mapping` that `roots` doesn't declare throws `SchemaParseError` naming the file and the IDs. `@askdb/enrich`'s `saveTenantPolicy()` (Studio's Save) refuses the same policy. Under `warn` these load in `schema.tenantPolicy.warnings`, as before. A root, scoped, polymorphic or global table that `schema.json` doesn't have stays a warning in both modes, and an entry for a removed table now reports only the table, not each of its columns. Cycle detection now follows every parent edge, so a cycle through a root that also has another parent is found wherever its edges appear in `hierarchy`.
  
  `ask()` logs the new `AskDbLogEvent.TenantPolicyWarnings` (`askdb.tenant.policy_warnings`) once per loaded schema when its policy has warnings, with `enforcement`, `warningCount` and `warnings`. It logs at `warn` level through the new optional `AskDbLogger.warn`, which `createAskDbLogger()` implements, and falls back to `info` for a logger without it. New export: `formatTenantPolicyWarning(warning)`, one line per problem.
  
  `@askdb/enrich`'s `saveTenantPolicy()` checks the policy against `schema.json` on disk rather than the workspace in memory, so Studio can save a corrected policy after a re-introspection left its workspace stale.
  
  `askdb introspect --out` checks an existing `tenant-policy.md` against the `schema.json` it just wrote and prints what no longer matches on stderr. The exit code stays 0.
  
  **Upgrade notes (breaking):** a strict policy that loads today with an orphaned column or foreign key, a cycle or an undeclared root now throws `SchemaParseError` from `loadSchema()`, `createAskDb()` and the HTTP API (400 `schema_parse_error`). Studio can't open that workspace until the file is fixed. Update `tenant-policy.md` to match `schema.json`; the error lists every ID to change.
- Updated dependencies [47eef72]
- Updated dependencies [d82125c]
- Updated dependencies [b40309d]
- Updated dependencies [f3decbb]
- Updated dependencies [7ca1940]
- Updated dependencies [234eec0]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [cdab7d7]
- Updated dependencies [ed7f35c]
- Updated dependencies [4d6a315]
- Updated dependencies [4d6a315]
  - @askdb/core@1.0.0-beta.46

## 0.2.0-beta.16

### Minor Changes

- c099a66: **Breaking:** `buildSuggestionTarget(schema, source)` and `buildSuggestionContext(schema, tableId)` take `loadSchema()`'s `NormalizedSchemaV2` instead of a `Workspace` (#625, ADR 0026). They used to hand the enrichment prompt the raw `schema.json` tables, so a column marked sensitive in table front-matter, or through a sensitive table, wasn't treated as sensitive. The target and neighbor tables now carry the loader's effective `sensitive` flags, and an untracked table (`tracked: false`) is no longer listed as a neighbor, as it isn't in `ask()`'s prompt.
  
  **Upgrade notes:** pass `loadSchema(workspace.schemaDir)` where you passed the workspace.
- 7378b80: `concepts.md` and `tenant-policy.md` saves no longer follow symbolic links (#372).
  
  - `saveConcepts()` now refuses to write when `concepts.md` is a symbolic link, with `Refusing to write concepts.md outside the schema directory: "concepts.md" is a symbolic link`. Before, a link planted at `concepts.md` (git stores symbolic links) made a save write to the file it pointed at, outside the schema directory.
  - New `saveTenantPolicy(workspace, frontmatter, body)` saves `tenant-policy.md` the same way. It first checks the policy with the core loader's rules and throws `SchemaParseError`, writing nothing, when `loadSchema()` would reject it.
  - `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` share one write path: a symbolic link at the target or at `tables/` is refused, and the content goes to a temp file renamed over the target. So `concepts.md` and `tenant-policy.md` saves are now atomic too, a hard link at either file is replaced instead of written through, and the replaced file keeps its permission bits, group and, where allowed, owner. A read-only file is still refused with `EACCES`. The schema directory itself may be a symbolic link.
  - Studio's tenant-policy save (`POST /api/tenant-policy`) calls `saveTenantPolicy()` instead of writing the file itself, so it refuses a symbolic link at `tenant-policy.md` too. A policy that wouldn't load still gets `400`.
  
  **Upgrade notes:**
  
  - A `saveConcepts()` caller whose `concepts.md` is a symbolic link now gets an error. Replace the link with a regular file in the schema directory.
  - Saving `concepts.md` or `tenant-policy.md` now needs write access to the schema directory, as saving a table already needs it for `tables/`: the temp file is created there. A writable file in a read-only schema directory now fails with `EACCES` instead of saving in place.

### Patch Changes

- Updated dependencies [c099a66]
- Updated dependencies [5bd780a]
- Updated dependencies [61f23b0]
- Updated dependencies [798cc4f]
- Updated dependencies [aa187f2]
- Updated dependencies [e8afa01]
  - @askdb/core@1.0.0-beta.45

## 0.2.0-beta.15

### Minor Changes

- a8be801: Include `tenant-policy.md` in schema bundles, and make table markdown filenames collision-safe and confined to `tables/`.
  
  - `bundleSchemaDirectory()` (used by `askdb bundle`) now writes the raw `tenant-policy.md` content as `tenantPolicy`. Before this fix, bundles left the policy out, so a multi-tenant schema loaded from a bundle came up with no tenant policy, and `ask()` stopped requiring a `tenantScope` or injecting tenant predicates. Rebuild any bundle made from a directory that has a `tenant-policy.md`. `loadSchema(bundle)` now equals `loadSchema(directory)`.
  - `bundleSchemaDirectory()` now fails, as `loadSchema()` does, when `tenant-policy.md`, `concepts.md` or `tables/` exists but can't be read (for example a symbolic link loop or a permission error). Only a missing file is left out of the bundle. Before, an unreadable file was skipped, so an unreadable tenant policy also produced a bundle without one.
  - `bundleSchemaDirectory()` returns `BundledSchemaV2` from `@askdb/core`, which owns the bundle format. `BundledSchemaV2` from `@askdb/enrich` is now a deprecated alias of it; import it from `@askdb/core` instead.
  - `loadWorkspace()` picks default filenames for tables that don't have a markdown file yet (ADR 0013). It uses `<schema>.<table>.md` when two tables share a bare name (for example `public.orders` and `archive.orders`), so saving one no longer overwrites the other. Names count as shared when a case-insensitive file system would store them as one file: case, Unicode normalization (NFC and NFD `café`) and full case folding (`straße`, `STRASSE` and `STRAẞE`) are ignored. It never reuses a name already in `tables/` under that comparison, including files the loader ignores, so `Orders.MD` blocks `orders.md`, but `orders.txt` doesn't. Existing files keep their names because they're matched by front-matter `id`.
  - Default filenames are made filename-safe: path separators, NUL, control characters, lone UTF-16 surrogates, and Windows-reserved characters become `_`, and leading dots get a `_` prefix. A name longer than 200 bytes, which SQL Server's 128-character identifiers can produce, is shortened and ends in `~` plus an 8-character hash instead of failing with `ENAMETOOLONG`.
  - `saveTable()` refuses any filename that would resolve outside `tables/`, so a table named like `../../x` can no longer write outside the schema directory. It also refuses to write when `tables/` or the target file is a symbolic link, and it writes through a temp file renamed over the target, so a hard link planted in `tables/` is replaced instead of written through. Saves are now atomic and `fsync`ed, and a read-only table file is still refused with `EACCES`. The replaced file keeps its permission bits and group (and its owner when the process may set it); when the group can't be kept, the group and others each get only the access both had. On macOS and Linux an existing file with `\` in its name still saves, since `\` separates paths only on Windows.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

### Patch Changes

- 7a0f777: **One rule for "mentions a sensitive column by name".** `@askdb/core` exports `findMentionedNames(text, names)`: a whole-word, case-insensitive match whose ends may not touch a letter, digit, or `_` of any script. `@askdb/rag`'s chunker and `@askdb/enrich`'s `findSensitiveColumnReferences` (Studio's authoring warning) both use it, so they agree on names like `ssn$` or `café`; before, enrich's `\b` boundaries missed `ssn$` and matched `caf` inside `café`. Studio keeps the details of a memory-store index in memory instead of `schema.lock.json`, which the indexer no longer writes for an ephemeral store.
- Updated dependencies [e7ea657]
- Updated dependencies [c610168]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [194de19]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [fa2e771]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
  - @askdb/core@1.0.0-beta.44

## 0.2.0-beta.14

### Patch Changes

- 70a9513: **@askdb/core**: `loadSchema()` and `loadSchemaFromJson()` now apply `sensitive: true` from table markdown front-matter (`tables/*.md`), at both the table and the `columns[]` level, on top of `schema.json`. Before, front-matter `sensitive` was parsed but ignored. Studio's Sensitivity tab writes front-matter, so a column marked Sensitive there was still treated as non-sensitive by the NL→SQL prompt (tagging and `omitSensitiveIdentifiersFromNlToSqlPrompt`), by `@askdb/rag` chunk exclusion, and by `validateSensitiveReferences`.

  The rule is escalate-only. Front-matter can make a table or column sensitive but can never make one less sensitive. A front-matter `sensitive: false` on a table or column that is sensitive anyway (from `schema.json`; for a column, also from a sensitive table or another front-matter entry's `sensitive: true`) is ignored and reported in `NormalizedSchemaV2.warnings` as the new `{ kind: "sensitivity_downgrade_ignored", tableFile, id }` warning. Directory and bundle loads behave the same way.

  A front-matter column ID is authoritative about which column it names. If a `columns[]` entry lists a column that belongs to a different table (for example `table:public.users#ssn` in `tables/orders.md`), its `sensitive: true` still escalates that column (dropping it would silently expose a column the author marked sensitive), and the loader reports the new `{ kind: "misplaced_column_id", tableFile, id, tableId }` warning, where `tableId` is the owning table. Nothing else in a misplaced entry is applied: `sensitive: false` never de-escalates, and its description, aliases, and enum are ignored.

  A column may be named by more than one `columns[]` entry, repeated in one file or across files. Sensitivity is aggregated across all of them: the column is sensitive if any entry says `sensitive: true`, and no entry's `sensitive: false` cancels it. Each repeat of an ID within one file is reported as the new `{ kind: "duplicate_column_id", tableFile, id }` warning, and only the first entry's description, aliases, and enum are applied.

  Two table markdown files whose front-matter has the same `id` are now a load error (`SchemaParseError` naming both files) for directory and bundle loads. Before, the loader silently kept whichever file it read last (which depended on filesystem order) and dropped the other's front-matter, including any `sensitive: true`, while Studio could pair the table with the other file. Table markdown files are now read in sorted filename order, so warning order is deterministic and identical for directory and bundle loads.

  The `tableFile` in loader warnings (`orphaned_table_id`, `orphaned_column_id`, `sensitivity_downgrade_ignored`, `misplaced_column_id`, `duplicate_column_id`) is now the table markdown file actually read (`tables/<filename>`, or the bundle's `tables` entry key). Before, it was derived from front-matter `name`, which is wrong when the filename differs (for example `tables/customer-records.md` with `name: users`).

  This is a behavior change: schemas whose front-matter already sets `sensitive: true` will now have more sensitive tables and columns. Those tables and columns lose their describable fields in the normalized schema, are tagged or omitted in prompts, are excluded from RAG chunks by default, and are flagged by the sensitive-SQL guardrail. Code that switches exhaustively over `SchemaV2Warning["kind"]` needs to handle the three new kinds.

  **@askdb/studio**: the Sensitivity tab's "Effective" column now matches the loader. It accounts for table-level sensitivity, and "Not sensitive" is disabled where it could not take effect, on both the Sensitivity and Enrichment tabs. The Enrichment tab's column "sensitive" badge also reflects table-level sensitivity.

  Studio also accounts for a column escalated from another table's markdown (shown as sensitive, with "Not sensitive" disabled), and saving a table no longer deletes `columns[]` entries for other tables' columns from its file.

  **@askdb/enrich**: `buildTableDraft()` marks a column sensitive when any of its front-matter entries says `sensitive: true`, not just the first. Before, a file listing a column twice (first `sensitive: false` or unset, then `sensitive: true`) produced a non-sensitive draft, so saving it in Studio rewrote the file without the escalation. `buildFrontmatter()` takes an optional fourth argument, the file's `existing` front-matter: its `columns[]` entries for IDs that are not the table's own columns (misplaced or orphaned) are carried through unchanged, so rewriting a file no longer silently drops another table's `sensitive: true`. `WorkspaceTable` has a new optional `escalatedByOtherFiles` field (set by `loadWorkspace()`) listing the table's columns that another table's markdown marks `sensitive: true`. `loadWorkspace()` now throws when two table markdown files share a front-matter `id` (it calls `loadSchema()`).

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [2787b21]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43

## 0.2.0-beta.13

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42

## 0.2.0-beta.12

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/core@1.0.0-beta.41

## 0.2.0-beta.11

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36

## 0.2.0-beta.9

### Patch Changes

- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21

## 0.2.0-beta.7

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/core@1.0.0-beta.20

## 0.2.0-beta.6

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/core@0.5.0-beta.12

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4

## 0.2.0-beta.0

### Minor Changes

- 373e152: Add `@askdb/enrich` as the shared Schema v2 enrichment workspace package.

  Studio and TUI now both depend on `@askdb/enrich` for workspace loading,
  draft construction, markdown section updates, persistence helpers, and AI
  suggestion target/context builders. Studio no longer depends on `@askdb/tui`.

### Patch Changes

- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0

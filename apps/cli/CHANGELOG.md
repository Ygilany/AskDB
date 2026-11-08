# askdb

## 1.0.0-beta.55

### Minor Changes

- 1df6a8d: `askdb ask` and `askdb bundle` print each warning `loadSchema()` returns, a tenant policy's included, as one `Warning:` line on stderr, and keep their exit code. Before, neither printed them, so a misplaced or duplicate `columns[]` entry, an orphaned table file, an ignored `sensitive: false`, or a tenant-policy entry for a removed table loaded silently. Stdout is unchanged.

### Patch Changes

- 18ef5a5: Security fix ([GHSA-p2v7-pv8j-c264](https://github.com/Ygilany/AskDB/security/advisories/GHSA-p2v7-pv8j-c264)). The tenant check read some names differently from the engine, so a scoped table's read could go unseen, a column the engine reads as another could count as the tenant column, or a join could count through another table:
  
  - **A name in NFC only before lower-casing.** CockroachDB lower-cases an unquoted name and then normalizes it to NFC, so `J` followed by U+030C reads as `ǰ`. Such an unquoted name is now refused as `UNICODE_ESCAPED_IDENTIFIER` unless the schema spells it exactly.
  - **A name the schema spells in upper case.** The schema's spelling excused an unquoted name with `İ`, or one whose lower-cased letters aren't in NFC, though CockroachDB reads an unquoted `İTEMS` as `items` even beside a table `"İTEMS"`. It now excuses an unquoted name only when the name is lower-case and in NFC.
  - **A final capital sigma.** CockroachDB lower-cases `Σ` to `σ`, which JavaScript's `toLowerCase` writes `ς` at the end of a word. The column-list rule and a derived table's items now match names letter by letter, as the table gate does.
  - **A joined table in another case.** A join the check relied on counted a table by its name in any case, though Postgres reads `"CLIENTS"` as another table than `clients`. A joined table now counts only where every engine the dialect covers reads it as the schema's table.
  
  Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: an unquoted name the schema doesn't spell whose lower-cased letters aren't in NFC (write it as the schema does); an unquoted name with `İ`, `ı`, `ſ`, the Kelvin sign or one of those letters that the schema spells but that isn't lower-case and in NFC (quote it as the schema spells it); and a join the check relies on whose table is spelled otherwise than the schema spells it, quoted, or unquoted on MySQL, MariaDB or SQL Server (write it as the schema does).
- Updated dependencies [7935ce0]
- Updated dependencies [cc5c00c]
- Updated dependencies [8e6c55f]
- Updated dependencies [42b6533]
- Updated dependencies [18ef5a5]
- Updated dependencies [568fd48]
  - @askdb/core@1.0.0-beta.55
  - @askdb/introspect@0.3.0-beta.29
  - @askdb/studio@0.2.0-beta.48
  - @askdb/sqlserver@0.1.0-beta.31
  - @askdb/client@1.0.0-beta.14
  - @askdb/enrich@0.2.0-beta.26
  - @askdb/mysql@0.1.0-beta.30
  - @askdb/postgres@0.2.0-beta.31
  - @askdb/rag@0.2.0-beta.35
  - @askdb/sqlite@0.1.0-beta.30

## 1.0.0-beta.54

### Patch Changes

- f258449: Security fix ([GHSA-rx3m-m5jr-pwch](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rx3m-m5jr-pwch)). The tenant check folded some names' letters differently from the engine, so a column the engine reads as another column could count as the tenant column, a discriminator or a `GROUP BY` key:
  
  - **CockroachDB** lower-cases every letter of an unquoted name, where Postgres folds only ASCII ones; both are read the Postgres way.
  - **MariaDB** keeps apart letters Unicode lower-casing merges, such as U+212A KELVIN SIGN and `k`.
  - **SQLite** folds only ASCII letters, and a `HAVING` predicate's `GROUP BY` key was compared with Unicode lower-casing.
  - **Aliases and qualifiers** with an upper-case non-ASCII letter were still compared the Postgres way, so on CockroachDB an unquoted `Ö.agency_id` could tie the predicate to another source.
  - **`İ` (U+0130), the Kelvin sign and names not in NFC as written:** CockroachDB and MySQL read `clİents` as `clients`, which the check never saw, and CockroachDB normalizes names to NFC.
  - **A scoped table whose name starts or ends with a non-ASCII letter** (`ürün`, `café`) was never seen as mentioned, so its reads needed no predicate.
  
  A name the engines of a reading read apart (read the Postgres way, an unquoted name with an upper-case non-ASCII letter) names nothing as a column, an alias, a qualifier or a CTE name. A name with a letter some engine folds into ASCII (U+0130, U+0131, U+017F, U+212A), or one that isn't in NFC as written, is refused as `UNICODE_ESCAPED_IDENTIFIER` unless the schema spells it exactly, and a table's name is found between characters that can't continue a name in any script.
  
  Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: read the Postgres way, an unquoted tenant column or discriminator with an upper-case non-ASCII letter (quote it, as the schema spells it); read the MySQL way or under `sqlite`, one whose non-ASCII letters are in another case than the schema's (write them as the schema does); read the Postgres way, an unquoted alias or qualifier with an upper-case non-ASCII letter (quote it); a name the schema doesn't spell that holds U+0130, U+0131, U+017F or U+212A, or isn't in NFC as written; and a read of a scoped table whose name starts or ends with a non-ASCII letter with no predicate.
- Updated dependencies [30a3bc6]
- Updated dependencies [f258449]
  - @askdb/client@1.0.0-beta.14
  - @askdb/core@1.0.0-beta.54
  - @askdb/studio@0.2.0-beta.47
  - @askdb/enrich@0.2.0-beta.25
  - @askdb/introspect@0.3.0-beta.28
  - @askdb/mysql@0.1.0-beta.29
  - @askdb/postgres@0.2.0-beta.30
  - @askdb/rag@0.2.0-beta.34
  - @askdb/sqlite@0.1.0-beta.29
  - @askdb/sqlserver@0.1.0-beta.30

## 1.0.0-beta.53

### Patch Changes

- 984f332: Security fix ([GHSA-9w7p-c3w8-4839](https://github.com/Ygilany/AskDB/security/advisories/GHSA-9w7p-c3w8-4839)). The tenant check read some table names, `HAVING` clauses and conditions differently from the engine, so a tenant-scoped query could pass while the engine read it without its tenant filter. The check now reads them the way each engine does:
  
  - **SQLite string names in parentheses.** SQLite reads `FROM ('orders')` as the table `orders`, and `(orders) 'o'` as that read aliased `o`. Under `sqlite`, a dialect id that is no built-in engine, or none, the tenant check reads them that way.
  - **`HAVING` on an ungrouped column.** A tenant predicate in `HAVING` counts only when its column is a key of the `SELECT`'s `GROUP BY`. Read the MySQL way, an unqualified column that a select-list item is aliased to doesn't count there.
  - **`BETWEEN`.** The `AND` that closes a `BETWEEN` is no conjunction, so a predicate written as its upper bound doesn't count.
  - **`order` or `group` after a spaced dot.** `billing . order` is the table `billing.order`, with any whitespace or comment around the dot.
  - **An `OR` after an alias spelled like a clause word.** An `OR` later in the clause counts as beside the predicate after a word some engine takes as a name (`lock`, `qualify`, `limit`, `natural`, `using`, `window`).
  - **Column names in another case.** A column name the engine reads as another column counted as the tenant column or a polymorphic discriminator, directly or passed through a derived table: on Postgres and CockroachDB, an unquoted `agencyid` beside a camelCase `"agencyId"`, or `"OWNER_TYPE"` beside `owner_type`; on SQL Server under a case-sensitive collation, `agencyid` beside `agencyId`; on SQLite, `égency_id` beside `Égency_id` in a filter. They now count only when written as the schema spells them: read the Postgres way, a quoted name exactly and an unquoted one with its ASCII letters lower-cased; the SQL Server way, as written; the MySQL way, lower-cased; the SQLite way, with ASCII letters lower-cased. A dialect id that is no built-in engine, or none, is read every way.
  
  Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: a tenant predicate in `HAVING` on a column the `SELECT` doesn't group by, or, read the MySQL way, on a name a select-list item is aliased to (put it in `WHERE`); a predicate written as a `BETWEEN`'s upper bound (make it its own conjunct); under `sqlite`, a custom id or none, an unfiltered read written `FROM ('orders')` (filter it, or write `FROM orders`); and a tenant column or discriminator written in another case than the schema spells it, under `sqlserver`, a custom id or none, or, read the Postgres way on a schema with upper-case column names, written unquoted (write it as the schema spells it, quoted on Postgres: `c."agencyId"`).
- Updated dependencies [01415e2]
- Updated dependencies [a81867a]
- Updated dependencies [98612fb]
- Updated dependencies [dadf211]
- Updated dependencies [01415e2]
- Updated dependencies [98612fb]
- Updated dependencies [984f332]
- Updated dependencies [a81867a]
  - @askdb/core@1.0.0-beta.53
  - @askdb/rag@0.2.0-beta.33
  - @askdb/studio@0.2.0-beta.46
  - @askdb/client@1.0.0-beta.13
  - @askdb/enrich@0.2.0-beta.24
  - @askdb/introspect@0.3.0-beta.27
  - @askdb/mysql@0.1.0-beta.28
  - @askdb/postgres@0.2.0-beta.29
  - @askdb/sqlite@0.1.0-beta.28
  - @askdb/sqlserver@0.1.0-beta.29

## 1.0.0-beta.52

### Minor Changes

- 0077500: **Breaking:** Studio picks the dialect with `@askdb/client`'s `resolveDialect()`, so a schema whose `provider` has no AskDB dialect is refused, as the CLI and the HTTP API already refused it (#886, ADR 0039). The Playground answers `422` with the client's `DialectNotSupportedError` message and generates nothing, instead of PostgreSQL SQL checked under PostgreSQL's rules. The workspace still loads: its `dialect` is `null`, with the reason in `dialectError`, and the Get the code panel shows the reason instead of code. Set `dialect` in `askdb.config.ts` to the built-in dialect your engine speaks. `askdb studio`, which runs Studio, refuses the same way. `@askdb/studio` now depends on `@askdb/client`.

### Patch Changes

- 2da504c: `askdb init --rag-store pgvector` writes a config that reads the pgvector connection URL from `PGVECTOR_URL` by default, not `ASKDB_PGVECTOR_URL`, and names that variable in `.env.example`. `--pgvector-env` still picks another name. A config that already reads `env("ASKDB_PGVECTOR_URL")` keeps working.
- dc750be: `askdb init` installs `@askdb/config` and the driver in a one-package project whose `pnpm-workspace.yaml` holds only settings, such as `minimumReleaseAgeExclude` (#863). It skipped the install there and printed the `pnpm add` command. It still skips at a workspace root: a `pnpm-workspace.yaml` that lists at least one package under `packages`, or a `package.json` with `workspaces`.
- 30d2348: `askdb` help says "schema directory" instead of "Schema v2" (#273), and marks the experimental surfaces ADR 0030 keeps at 0.x (#662). `askdb --help` tags `studio`, `enrich`, `bundle` and `rag` "(experimental)" and links ADR 0030. `askdb bundle --help` and `askdb rag --help` add a note that a minor release may change them. `askdb init --help` heads its RAG and Studio options "(experimental)", since they write the experimental `rag` and `studio` blocks. A blank `--question` now fails before `askdb ask` looks for a config or a schema, with a message that names `-q / --question` itself, because `@askdb/core`'s message no longer names CLI flags (#719); the exit code is still `1`.
- 8d706ae: `askdb ask`'s hint after a schema that doesn't load no longer names `fixtures/schemas/orders-users.schema/`, a folder only AskDB's repository holds (#850). On `Schema path not found.`, `Schema path is not readable (permission denied).`, `Failed to parse schema.` and `Failed to load schema.`, it now says to use a schema directory that `askdb introspect` wrote, and links the troubleshooting guide.
- 109c581: Security fix ([GHSA-rhwf-7742-8hwj](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rhwf-7742-8hwj)). The tenant check read a number written right against a keyword (`1.0OR`, `1OR`) as one word, and likewise a `$N` parameter (`$1OR`). MySQL and MariaDB end such a number after its decimal point or exponent, PostgreSQL 14 and earlier at its last digit, and PostgreSQL 14 and CockroachDB end a `$N` parameter at its last digit. So the check missed an `OR` that the engine read, and a tenant-scoped query could pass with its tenant predicate beside it. The check now ends a number where each engine does: after its decimal point or exponent on MySQL and MariaDB, where a name that starts with digits (`3d_models`) stays one name, and at its last digit on PostgreSQL and CockroachDB. Wherever the SQL may be read as Postgres (`postgres`, `cockroachdb`, a dialect id that is no built-in engine, or none), it refuses a `$N` parameter written against a word, as `NOT_SELECT_OR_WITH`. Enforce tenant isolation in the database (for example row-level security) regardless.
- a7756fd: Security fix ([GHSA-rpcp-322q-q738](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rpcp-322q-q738)). The tenant check read some names, comments and joins differently from the engine, so a tenant-scoped query could pass while the engine read it without its tenant filter. The check now reads them the way each engine does:
  
  - **`]]` and nested comments.** On SQL Server, `]]` inside a bracketed name is an escaped `]`, so `[o]] WHERE … AND [x]` is one name. On SQL Server, PostgreSQL and CockroachDB, block comments nest, so the check reads them both nested and not, and a predicate counts only when both readings see it. A predicate inside such a name or comment no longer counts.
  - **Names outside printable ASCII.** SQL Server resolves a name through the database collation, which ignores some characters (U+200D, U+FEFF, any emoji) and reads others as ASCII letters (fullwidth letters, small capitals), so `[ｏｒｄｅｒｓ]` reads `orders`. Under `sqlserver`, a dialect id that is no built-in engine, or none, the tenant check refuses a name, quoted or not, that holds a character outside printable ASCII as `UNICODE_ESCAPED_IDENTIFIER`, and the sensitive check reports it as unresolved scope, unless the schema spells it exactly. This covers aliases and CTE names too.
  - **Column lists after an alias.** PostgreSQL and CockroachDB read `orders t (agency_id, x)` as new names for the table's first columns, so `t.agency_id` filtered another column. A column list on a parenthesized join or derived table renames its output the same way, so in `(orders o JOIN lookup_states s ON true) AS j (a1, a2, agency_id)` an unqualified `agency_id` was the join's third column. Wherever the SQL may be read as Postgres, such a read is refused as `MISSING_TENANT_PREDICATE`.
  - **Outer joins with a hint.** A join with `LEFT`, `RIGHT`, `FULL` or `OUTER` among its words is outer, whatever hint stands beside it, so CockroachDB's `LEFT STRAIGHT JOIN`, `LEFT LOOKUP JOIN` and `LEFT INVERTED JOIN` no longer count their `ON` as a filter. Neither does an `ON` that closes an earlier join (`a LEFT JOIN b JOIN c ON … ON …`).
  - **Quoted tenant columns.** PostgreSQL and CockroachDB compare a quoted name exactly, so `"AGENCY_ID"` can be another source's column. Wherever the SQL may be read as Postgres, a quoted tenant column counts only when spelled as the schema spells it.
  - **SQLite's single-quoted table names.** SQLite reads a `'…'` in a table's place as the table's name, so `SELECT * FROM 'orders'` read `orders` with no tenant predicate, and `SELECT * FROM 'users'` reached its sensitive columns. Under `sqlite`, a dialect id that is no built-in engine, or none, such a string right after `FROM`, `JOIN` or `IN`, after a `,` in a `FROM` list, or beside a `.` is now read as the table's name by the tenant and sensitive checks. SQLite also reads a `'…'` right after a table or CTE reference as its alias, so in `FROM sub_agencies 'o', orders` a predicate on `o.agency_id` filters `sub_agencies`, not `orders`; the tenant check now reads it as that alias.
  - **Quoted names spelled like a placeholder.** A quoted name such as `":tenant_agency_ids"`, `` `:tenant_agency_ids` `` or `[:tenant_agency_ids]` is a column to the engine and nothing binds it, but the check counted it as the placeholder. It no longer does. A U+0001 inside a quoted name no longer changes which later words the check reads as keywords.
  
  Enforce tenant isolation in the database (for example row-level security) regardless.
- Updated dependencies [30d2348]
- Updated dependencies [4e79c4d]
- Updated dependencies [0077500]
- Updated dependencies [f59a7e1]
- Updated dependencies [30d2348]
- Updated dependencies [dc750be]
- Updated dependencies [6320c85]
- Updated dependencies [f11909c]
- Updated dependencies [4e79c4d]
- Updated dependencies [30d2348]
- Updated dependencies [4188c04]
- Updated dependencies [97312e1]
- Updated dependencies [39a4a5e]
- Updated dependencies [8069854]
- Updated dependencies [f11909c]
- Updated dependencies [4e79c4d]
- Updated dependencies [30d2348]
- Updated dependencies [4e79c4d]
- Updated dependencies [30d2348]
- Updated dependencies [109c581]
- Updated dependencies [a7756fd]
- Updated dependencies [0077500]
- Updated dependencies [6320c85]
- Updated dependencies [30d2348]
- Updated dependencies [2da504c]
  - @askdb/ai@0.1.0-beta.12
  - @askdb/client@1.0.0-beta.13
  - @askdb/config@1.0.0-beta.20
  - @askdb/core@1.0.0-beta.52
  - @askdb/introspect@0.3.0-beta.26
  - @askdb/enrich@0.2.0-beta.23
  - @askdb/rag@0.2.0-beta.32
  - @askdb/postgres@0.2.0-beta.28
  - @askdb/studio@0.2.0-beta.45
  - @askdb/mysql@0.1.0-beta.27
  - @askdb/sqlite@0.1.0-beta.27
  - @askdb/sqlserver@0.1.0-beta.28

## 1.0.0-beta.51

### Patch Changes

- 4196800: Security fix ([GHSA-rmjw-pffc-5hjr](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rmjw-pffc-5hjr)), a residual of [GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4) finding 1. The tenant check read a dollar-quoted string whose tag holds non-ASCII letters (`$é$ … $é$`) as code, where Postgres, CockroachDB and the shared lexer read it as a string, so a tenant-scoped query could pass the check without an effective tenant predicate. The check's scanner now reads the tag with the same character set as the shared lexer and the engine. Enforce tenant isolation in the database (for example row-level security) regardless.
- Updated dependencies [6c8c88b]
- Updated dependencies [8e75d50]
- Updated dependencies [8e75d50]
- Updated dependencies [dc398be]
- Updated dependencies [4196800]
  - @askdb/core@1.0.0-beta.51
  - @askdb/enrich@0.2.0-beta.22
  - @askdb/rag@0.2.0-beta.31
  - @askdb/studio@0.2.0-beta.44
  - @askdb/client@1.0.0-beta.12
  - @askdb/introspect@0.3.0-beta.25
  - @askdb/mysql@0.1.0-beta.26
  - @askdb/postgres@0.2.0-beta.27
  - @askdb/sqlite@0.1.0-beta.26
  - @askdb/sqlserver@0.1.0-beta.27

## 1.0.0-beta.50

### Minor Changes

- 1b9468d: `askdb ask`, `askdb rag` and Studio build their models from the config's typed `ai.language` and `ai.embedding` sections, since `@askdb/config` no longer builds the AI env maps they read (#711). `askdb rag --embedder-model` still overrides `ai.embedding.model`. A config that sets a key `@askdb/config` 1.0.0-beta.19 removed (#765), such as `model` on an `ai.providerConfig` connection or `rag.embedder: "openai"`, now fails to load in the CLI, Studio and the HTTP API, with an error naming each key's replacement; the upgrade guide shows each one before and after.
- db7dad6: `askdb bundle` refuses a schema directory `loadSchema()` refuses, and exits 1 with the loader's error before it writes anything (#796). It used to bundle markdown the loader refuses, such as front-matter that isn't YAML, a tenant policy that doesn't parse, or two table files with the same `id`, and exit 0, so the bundle failed only when a service loaded it. On a failure it writes nothing, and a file already at `--out` stays as it was. A bundle it writes always loads. The check is `@askdb/enrich`'s `bundleSchemaDirectory()`, which the command calls.
- 0782a06: `askdb introspect` exits 1 when the source has no tables or views to write (#337, ADR 0037), with `--out`, `--print` and `--diff` alike, where it used to exit 0 and write a `schema.json` with `tables: []` that `loadSchema` rejects. The message names the schema id, the engine and any `--schemas`, `--exclude-schemas` or `--tables` filters, and lists the likely causes. Nothing is written, so an existing artifact stays as it was.
- 54e079e: **Breaking:** `askdb rag --embedder openai` and `--embedder ai-sdk` are removed (#811), as the same `rag.embedder` values were in 1.0.0-beta.50 (#765). They were deprecated aliases of `--embedder ai` since 1.0.0-beta.44, promised for removal at 1.0. Each now fails with exit code `1` before the command reads the schema or opens a store, with an error naming the replacement: `--embedder ai`, with `rag.embedder: "ai"` and an `ai.embedding` section in `askdb.config.*`. An index the aliases built keeps its embedder id, since they embedded with `ai.embedding` too.

### Patch Changes

- 3841e09: `askdb init --database sqlserver` and Studio's guided setup no longer put `Trust Server Certificate=True` in the `.env.example` hint for the SQL Server connection string (#803). That key turned the certificate check off in AskDB, and the `mssql` driver ignored it because of the spaces, so a hint copied into production trusted any certificate in AskDB but not in a host's own `mssql` pool. The hint now leaves the key out, so AskDB and `mssql` both check the certificate by default. A second comment line says to add `TrustServerCertificate=True;`, spelled without spaces so both read it, for a development server with a self-signed certificate such as the SQL Server Docker image. An `.env.example` that `init` already wrote isn't changed.
- 91e89ec: Security fix ([GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4)). The tenant check could read some SQL differently from the database engine — a `$` inside a name, a table named after a keyword such as `user` or `lock`, an unset `backslashEscapes` on a from-scratch MySQL-family `DialectSpec`, and where a `--` comment ends — so a tenant-scoped query could pass the check without an effective tenant predicate. The check now reads each construct the way the engine does, and a test per engine confirms it on a live database. Tenant isolation enforced in the database (for example row-level security), as `SECURITY.md` recommends, still limited what such a query could read.
- Updated dependencies [6ea8df8]
- Updated dependencies [1b9468d]
- Updated dependencies [d9ab606]
- Updated dependencies [a467984]
- Updated dependencies [54e079e]
- Updated dependencies [1b9468d]
- Updated dependencies [1b9468d]
- Updated dependencies [6ea8df8]
- Updated dependencies [1ccc8c8]
- Updated dependencies [1b9468d]
- Updated dependencies [1b9468d]
- Updated dependencies [3841e09]
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
- Updated dependencies [a7f5f06]
- Updated dependencies [3b77292]
- Updated dependencies [0782a06]
- Updated dependencies [54e079e]
- Updated dependencies [91e89ec]
- Updated dependencies [0782a06]
- Updated dependencies [3a05107]
  - @askdb/ai@0.1.0-beta.11
  - @askdb/studio@0.2.0-beta.43
  - @askdb/client@1.0.0-beta.12
  - @askdb/config@1.0.0-beta.19
  - @askdb/core@1.0.0-beta.50
  - @askdb/mysql@0.1.0-beta.25
  - @askdb/sqlite@0.1.0-beta.25
  - @askdb/sqlserver@0.1.0-beta.26
  - @askdb/enrich@0.2.0-beta.21
  - @askdb/introspect@0.3.0-beta.24
  - @askdb/rag@0.2.0-beta.30
  - @askdb/postgres@0.2.0-beta.26

## 1.0.0-beta.49

### Minor Changes

- 2cd28cb: `askdb init` writes its files from the scaffold planner in `@askdb/config/scaffold`, which Studio's guided setup shares (#711). `askdb.config.ts` doesn't change. `init` now rejects some flag values it accepted, so this is a minor:
  
  - **An invalid env var name fails.** `--connection-env`, `--ai-key-env`, `--ai-model-env` and `--pgvector-env` take a name of uppercase letters, digits and underscores that doesn't start with a digit (`DATABASE_URL`, `_PRIVATE_URL`). Anything else, such as `my-url` or `database_url`, used to land in the config as `env("my-url")` and now fails.
  - **A path with a control character fails.** `--sqlite-file`, `--prisma-schema` and `--schema-out` reject a newline, a tab, NUL, DEL, U+2028 or U+2029. (`--sqlite-file` still reads a value that isn't an env var name as a path, as before.)
  - Either way, `init` exits 1 before it writes anything, with an error that names the flag, such as `--connection-env must be an environment variable name like DATABASE_URL: …`.
  
  Other changes:
  
  - **`.env.example` leaves every value empty.** Each variable is an empty `NAME=` line under a `# purpose` comment, database variables first. A connection URL's format moves from its value (`DATABASE_URL=postgresql://<USERNAME>:…`) into that comment, and a variable that introspection and Studio execute share says so.
  - **`--database prisma` also installs `ai` and `zod`** (#760): `ai` at the newest major `@askdb/core` accepts, and `zod` at core's range. Under Yarn Plug'n'Play, `askdb introspect --engine prisma` failed without them (`@askdb/core tried to access ai`).
  - **`init` installs a package other than AskDB's own only when `package.json` doesn't list it yet.** A project on `ai@^6` keeps it, and a driver you already list isn't re-added at its latest version.

### Patch Changes

- c29dcad: `askdb` tidies its internals before 1.0 (#712). Commands, flags, help text, output, exit codes, log events and the files `askdb init` writes are unchanged.
- 1dcfc28: `askdb ask` and `askdb init` no longer print an empty error detail for an error that has no message of its own (#781). Three places printed `error.message`, which is empty for one: the `errMessage` of `askdb ask`'s `askdb.run.error` log event, the `Details:` line when `askdb ask` can't load the schema, and `askdb init`'s `Failed to write config:` line. They now print what `askdb introspect` prints since #749: each inner error's message for an `AggregateError`, else the error's `code`, else its name.
- eef1321: `askdb init --connection-env <name> --studio-execute` now points Studio execute at the same env var as introspection, as the interactive wizard already did (#777). Before, the non-interactive path wrote `studio.execute.databaseUrl: env("DATABASE_URL")` whatever `--connection-env` named. With `--database prisma`, execute still targets Postgres and reads `DATABASE_URL`.
- 0e5d542: `askdb init` installs with the right package manager, on Windows too:
  
  - **A new pnpm project installs with pnpm** (#750). With no lockfile, `init` fell back to npm, which refuses a project that `pnpm init` started (`EBADDEVENGINES`). It now reads `package.json`'s `packageManager` or `devEngines.packageManager` field, then the tool that ran it (`pnpm dlx`, `yarn dlx`, `npx`, `bunx`), before falling back to npm. An existing lockfile still wins.
  - **The install runs on Windows** (#668). `init` spawned `pnpm.CMD`, `yarn.cmd` or `npm.cmd` without a shell, which Node refuses since its CVE-2024-27980 fix, so the install always failed. It now spawns the package manager as Studio does: allowlisted arguments, the bare command name, and a shell on Windows.
  - **The command `init` prints when it doesn't install names the package manager it picked**, with the `@prisma/engines` build approval on pnpm 10.4 or later. At a workspace root, or with no `package.json`, it printed `npm install --save …`.
- b030324: Every `askdb` command parses, documents and checks its flags the same way (#711). Each command's flags live in one table that both the parser and its `--help` read, so the help can't leave out a flag the command takes. `askdb` no longer depends on `commander`. Visible changes:
  
  - **`askdb help <command>` prints exactly what `askdb <command> --help` prints.** `askdb init --help` now lists `--interactive`, `-f` and `-y`, which it accepted but didn't document.
  - **Every command but `studio` and `enrich` takes `--flag=value`**, `askdb init` and `askdb bundle` included. Short flags combine as `askdb ask` took them under `commander` (`-qtext`, `-vq text`), now in every command (`askdb init -fy`).
  - **`askdb init` errors stop repeating values that could be secrets.** An unknown option, a stray argument or an invalid value is repeated only when it looks like a name or a number, as in the other commands.
  - **`askdb ask`'s usage errors read like the other commands'**: `Unknown option: --x` instead of `error: unknown option '--x'`, and `Missing --question <text>.` for a missing question. The exit code is still `1`.
  - **`askdb --help`, `askdb ask --help` and `askdb rag --help` use the shared layout**, with every flag listed under `Options:`.
  - **`askdb rag` with flags but no command says `Missing command (expected 'index', 'query', or 'setup-store')`** instead of `Unknown command: --flag`. `askdb rag` with no arguments still prints its help.
  - **`askdb introspect templates` works wherever the flags put `templates`**, such as `askdb introspect --engine postgres templates`.
  - **`askdb bundle --help` prints its help on stdout and exits `0`.** Without both `<schema-dir>` and `--out`, `bundle` still prints its usage line on stderr and exits `1`, and its flags may now come in any order.
  - **A failed connection prints why** (#749). When a driver gives up on several addresses, such as `localhost` refusing on both `::1` and `127.0.0.1`, `askdb introspect` printed an empty line. It now prints each address's error on its own line.
  - **`--log-stdout` into a reader that stops early no longer hangs.** `askdb rag index --log-stdout | head` waited forever on the unwritten log lines; `askdb` now exits once its output settles.
- 4437394: Security fix ([GHSA-wjgj-mf9h-6g68](https://github.com/Ygilany/AskDB/security/advisories/GHSA-wjgj-mf9h-6g68)). With `tenantSqlMode: "sql-only"` on the built-in `postgres` or `cockroachdb` dialect, `ask()` could return SQL whose tenant scoping no longer held once the tenant IDs were inlined, because it did not re-check the rendered statement. `ask()` now runs the read-only check on the `sql` it returns, as `bindPreparedQuery()` already does, and refuses a statement that reads differently once rendered. The default `tenantSqlMode: "sql-params"`, which binds tenant IDs as driver parameters, was never affected.
- Updated dependencies [150a293]
- Updated dependencies [0e5d542]
- Updated dependencies [4a83b61]
- Updated dependencies [a8cef1b]
- Updated dependencies [ca816cc]
- Updated dependencies [29a0fc1]
- Updated dependencies [396ad23]
- Updated dependencies [82c2f94]
- Updated dependencies [a8cef1b]
- Updated dependencies [4437394]
- Updated dependencies [a8cef1b]
- Updated dependencies [0e5d542]
- Updated dependencies [ee12e92]
  - @askdb/config@1.0.0-beta.18
  - @askdb/core@1.0.0-beta.49
  - @askdb/introspect@0.3.0-beta.23
  - @askdb/postgres@0.2.0-beta.25
  - @askdb/mysql@0.1.0-beta.24
  - @askdb/sqlite@0.1.0-beta.24
  - @askdb/sqlserver@0.1.0-beta.25
  - @askdb/studio@0.2.0-beta.42
  - @askdb/client@1.0.0-beta.11
  - @askdb/enrich@0.2.0-beta.20
  - @askdb/rag@0.2.0-beta.29

## 1.0.0-beta.48

### Minor Changes

- 63d45cc: The HTTP API server and the CLI use `logging.level` as `@askdb/config` resolves it, without checking it again (#711). Behavior is unchanged: the config already refuses a level that isn't one of `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` when it loads.

### Patch Changes

- c28c967: Depend on `zod` (`^4.6.7`, the same range as `@askdb/core`), the peer that `ai` and the `@ai-sdk/*` packages require, so Yarn Plug'n'Play can resolve it (#748). `yarn dlx askdb` crashed at startup because these packages install `ai` without providing its `zod`. npm and pnpm already installed `zod` through `@askdb/core`, so they install nothing new.
- Updated dependencies [63d45cc]
- Updated dependencies [63d45cc]
- Updated dependencies [294ef92]
- Updated dependencies [f8f99cb]
- Updated dependencies [180f28a]
- Updated dependencies [9e49e34]
- Updated dependencies [b52a89f]
- Updated dependencies [229a592]
- Updated dependencies [1c31e95]
- Updated dependencies [31f90a3]
- Updated dependencies [ca4af5b]
- Updated dependencies [31f90a3]
- Updated dependencies [31f90a3]
- Updated dependencies [c28c967]
- Updated dependencies [c28c967]
  - @askdb/client@1.0.0-beta.11
  - @askdb/config@1.0.0-beta.17
  - @askdb/core@1.0.0-beta.48
  - @askdb/introspect@0.3.0-beta.22
  - @askdb/mysql@0.1.0-beta.23
  - @askdb/postgres@0.2.0-beta.24
  - @askdb/sqlite@0.1.0-beta.23
  - @askdb/sqlserver@0.1.0-beta.24
  - @askdb/enrich@0.2.0-beta.19
  - @askdb/studio@0.2.0-beta.41
  - @askdb/rag@0.2.0-beta.28

## 1.0.0-beta.47

### Patch Changes

- Updated dependencies [946dee4]
- Updated dependencies [f183629]
- Updated dependencies [3d9bc33]
- Updated dependencies [f4e60a9]
- Updated dependencies [80c7ddf]
- Updated dependencies [0a94c6f]
- Updated dependencies [4f322db]
- Updated dependencies [4365d4c]
  - @askdb/ai@0.1.0-beta.10
  - @askdb/client@1.0.0-beta.10
  - @askdb/config@1.0.0-beta.16
  - @askdb/core@1.0.0-beta.47
  - @askdb/studio@0.2.0-beta.40
  - @askdb/enrich@0.2.0-beta.18
  - @askdb/introspect@0.3.0-beta.21
  - @askdb/mysql@0.1.0-beta.22
  - @askdb/postgres@0.2.0-beta.23
  - @askdb/rag@0.2.0-beta.27
  - @askdb/sqlite@0.1.0-beta.22
  - @askdb/sqlserver@0.1.0-beta.23

## 1.0.0-beta.46

### Minor Changes

- 76dc3a3: `@askdb/prisma` is now an optional peer of `askdb` and `@askdb/studio`, not a dependency. `pnpm add askdb` no longer installs Prisma, so it exits 0 on pnpm 11, which refused to run the unapproved `@prisma/engines` install script and exited 1 (#259). The CLI and Studio import `@askdb/prisma` only for Prisma introspection (#339), so `askdb --help` and every other command load no Prisma module.
  
  **Breaking** for Prisma users: install `@askdb/prisma` next to `askdb` (`npm i @askdb/prisma`). On pnpm 11, approve its `@prisma/engines` build in the same command, `pnpm add --allow-build=@prisma/engines @askdb/prisma`, or run `pnpm approve-builds` afterwards. Without the package, `askdb introspect --engine prisma` exits 1 naming it, and Studio shows the same message instead of resyncing. `askdb` looks for `@askdb/prisma` in its own install, then in the project it runs in, so `npx askdb introspect` uses the project's copy.
  
  `askdb init --database prisma` now installs `@askdb/prisma` at the version of the `askdb` running it. Studio's guided setup installs it within Studio's peer range, so a newer `askdb` hosting Studio still gets a version its own range accepts. With pnpm 10.4 or later both approve the `@prisma/engines` build (older pnpm has no `--allow-build`). `@askdb/prisma`'s README says to install it next to `askdb`.
  
  Studio's guided setup now checks for installed packages on disk rather than through Node's resolver (under Yarn Plug'n'Play, which has no `node_modules`, it still asks the resolver). On Node 24 and later, a failed lookup could last until Studio exited, so the introspection step couldn't load a driver or `@askdb/prisma` that setup had just installed.

### Patch Changes

- 9ef4a6f: `askdb ask` and `askdb introspect` help, errors and the package README name the `askdb.config` keys that control each setting (`modes.askdbMode`, `dev.mockSql`, `logging.correlationId`, `introspection.outputDir`, `introspection.providerConfig.<engine>.databaseUrl`) instead of `ASKDB_*` and `DATABASE_URL` variables that AskDB never reads from the environment (#281). `askdb introspect --help` now lists every flag it accepts, including `--print`, `--diff`, `--engine`, `-v` and `--log-stdout`: the help and the parser are built from one flag table, and `--engine` lists the engines of the registry in use. `askdb introspect` also takes `--flag=value` like `--flag value`, as `askdb rag` does, and its argument errors no longer repeat a value, so a connection string passed as `--url=…` or as a stray argument stays out of the error.
- 2234954: `askdb.config.mjs` and a plain `export default { … }` config now load, as the docs say (#264, #265). `bootstrapAskDbEnv()`, and so the `askdb` CLI, Studio and the HTTP API, loads every documented extension synchronously, `.mjs` included; the file can't use top-level `await`. A plain object goes through the same normalizing, checks and deprecation warnings as `defineConfig({ … })`, which stays the typed helper and still returns the projection.
  
  A config without its `ai` or `introspection` block now fails to load with an error that names the file and the missing block (`AskDB config at <path>: the config has no ai block; …`), instead of a bare `TypeError` (#626). Every `askdb.config: …` error raised while a file loads now names that file the same way; calling `defineConfig` directly keeps the `askdb.config:` prefix. A file with no default export, a default export that isn't a plain object (`null`, a string, a Promise), and top-level `await` each fail with an error that names the file and says what to change, instead of a misleading or bare one.
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
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [2234954]
- Updated dependencies [9ef4a6f]
- Updated dependencies [d82125c]
- Updated dependencies [b40309d]
- Updated dependencies [f3decbb]
- Updated dependencies [7ca1940]
- Updated dependencies [02387ec]
- Updated dependencies [76dc3a3]
- Updated dependencies [234eec0]
- Updated dependencies [76dc3a3]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [cdab7d7]
- Updated dependencies [ed7f35c]
- Updated dependencies [9ef4a6f]
- Updated dependencies [0868651]
- Updated dependencies [4d6a315]
- Updated dependencies [4d6a315]
- Updated dependencies [8fbc115]
  - @askdb/core@1.0.0-beta.46
  - @askdb/client@1.0.0-beta.9
  - @askdb/config@1.0.0-beta.15
  - @askdb/mysql@0.1.0-beta.21
  - @askdb/sqlite@0.1.0-beta.21
  - @askdb/sqlserver@0.1.0-beta.22
  - @askdb/introspect@0.3.0-beta.20
  - @askdb/enrich@0.2.0-beta.17
  - @askdb/studio@0.2.0-beta.39
  - @askdb/postgres@0.2.0-beta.22
  - @askdb/rag@0.2.0-beta.26

## 1.0.0-beta.45

### Minor Changes

- 3191966: `createAskDb().ask()` now applies config `modes.askdbMode` (#279, ADR 0025). Before, the client ignored it: a call that named no `mode` ran core's default, `schema_only`, whatever the config said. Only the CLI and the HTTP API read the config mode, each on its own.
  
  The config mode is the loosest mode a call gets, the same rule as the `modes.omitSensitiveFromPrompt` floor. A call that names no mode runs the config mode. An unset config counts as `schema_only`. A call's `mode: "schema_only"` tightens a config of `bounded_results` for that call.
  
  The CLI and the HTTP API now pass only the caller's mode to the client, so all three surfaces resolve it the same way. A bad `--mode` still exits 1, and a bad body `mode` or `x-askdb-mode` header still returns `400`.
  
  **Upgrade notes (breaking):**
  
  - A per-call mode can no longer loosen the config. `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `mode: "bounded_results"` now run `schema_only` unless `askdb.config.*` sets `modes: { askdbMode: "bounded_results" }`. There's no error: the `askdb.pipeline.mode` log line records the mode that ran. Today's SQL output doesn't change, because `bounded_results` still produces the same SQL as `schema_only`.
  - The `askdb.run.start` log lines from the CLI and the HTTP API no longer carry a `mode` field. Read `mode` from `askdb.pipeline.mode`, which is in the same log stream.
  - `ask()` parses a call's `mode` the way it parses the config's, so `"SCHEMA-ONLY"` tightens like `"schema_only"`, and an unknown value throws `AskDbError` where it used to reach core unchecked. Typed TypeScript callers can't pass one.
  - An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are validated when they load, as before.

### Patch Changes

- 720abe7: `@askdb/prisma` now loads `@prisma/internals` on the first `describePrismaSchema()` call (or the first `describe()` of a connector from `createPrismaConnector()`), not when the package is imported. Hosts that register `prismaConnectorProvider`, as the `askdb` CLI and Studio do, no longer pay for Prisma on every start: `askdb --help` loads no `@prisma/*` module and starts in about half the time (0.27s to 0.14s median on one machine). Introspecting a Prisma schema works as before.
- Updated dependencies [5bd780a]
- Updated dependencies [3191966]
- Updated dependencies [d9b88f8]
- Updated dependencies [c099a66]
- Updated dependencies [5bd780a]
- Updated dependencies [c099a66]
- Updated dependencies [7378b80]
- Updated dependencies [61f23b0]
- Updated dependencies [798cc4f]
- Updated dependencies [720abe7]
- Updated dependencies [3d62eb5]
- Updated dependencies [aa187f2]
- Updated dependencies [e8afa01]
- Updated dependencies [c099a66]
- Updated dependencies [8f906c3]
  - @askdb/client@1.0.0-beta.8
  - @askdb/config@1.0.0-beta.14
  - @askdb/core@1.0.0-beta.45
  - @askdb/enrich@0.2.0-beta.16
  - @askdb/studio@0.2.0-beta.38
  - @askdb/rag@0.2.0-beta.25
  - @askdb/prisma@0.2.0-beta.19
  - @askdb/introspect@0.3.0-beta.19
  - @askdb/postgres@0.2.0-beta.21
  - @askdb/ai@0.1.0-beta.9
  - @askdb/mysql@0.1.0-beta.20
  - @askdb/sqlite@0.1.0-beta.20
  - @askdb/sqlserver@0.1.0-beta.21

## 1.0.0-beta.44

### Minor Changes

- e511e16: **`askdb rag` replaces the `askdb-rag` binary, reads `askdb.config.*`, and assumes no embedding width.**
  
  - **`askdb rag index | query | setup-store`** is the RAG CLI now, in the `askdb` package. `@askdb/rag` no longer depends on `@askdb/config`, so a host that embeds the library doesn't install the config loader. Its `askdb-rag` binary stays until 1.0 as a stub that names the `askdb rag` command to run, without echoing its arguments, and exits `1`; it doesn't forward, because `askdb rag` reads its store from config where `askdb-rag` always defaulted to the file store.
  - **Config fallbacks.** Flags still win. The schema dir falls back to `introspection.outputDir`, `--store` to `rag.store`, `--pg-url` and `--pg-table` to `rag.storeConfig.pgvector`, `--file-path` to `rag.storeConfig.file.basePath`, and `--embedder` to `rag.embedder`. The pgvector index strategy comes from `rag.storeConfig.pgvector.indexStrategy`. A store flag for a store the run doesn't use (`--file-path` on pgvector, `--pg-url` or `--pg-table` on the file or memory store) is an error. `askdb rag --help` and `--version` work without a config. Flags take `--flag value` or `--flag=value`. An error repeats an argument only when it looks like a name or number, and a connection string in place of `[schema-dir]` is refused, so a password typed in the wrong place doesn't reach stderr.
  - **`--embedder mock|ai`.** `ai` embeds with the `ai.embedding` model, through the same path as Studio, and needs `rag.embedder: "ai"`. `--embedder-model` overrides `ai.embedding.model`. `--embedder openai` and `--embedder ai-sdk` are deprecated aliases of `ai` until 1.0 and print a warning; `openai` also requires `ai.embedding.provider: "openai"`. To migrate from `--embedder openai`, configure `ai.embedding` and `rag.embedder: "ai"`.
  - **`--api-key` is removed.** Set the key on a connection in `ai.providerConfig`.
  - **AI embedder ids change** from `openai:<model>[:<dims>]` to Studio's `ai-sdk:<provider>:<model>:<dims|default>`, so the CLI and Studio accept each other's indexes. An index built by `askdb-rag --embedder openai` re-embeds once on the next `askdb rag index`, and `query` refuses it until then. Mock indexes (`mock:lexical-<dims>`) stay valid.
  - **No assumed width.** `setup-store` requires `--dimensions` and fails before connecting without it; it used to default to the mock embedder's 64, or 1536 with `--embedder openai`. The CLI's list of OpenAI model widths is gone: `index` and `query` take `--dimensions`, else `ai.embedding.dimensions`, else the model's own width (mock: 64), and `index` learns a new pgvector table's width from the model. A pgvector table of another width fails before any chunk is embedded, with the fix in flags: drop the table, pass `--pg-table` for a new table, or pass `--dimensions <table width>`.
- c6e289a: The OpenAI, Azure OpenAI / Foundry, Google, and Anthropic providers are now built into `@askdb/ai`. The `@askdb/ai-*` packages are deprecated (ADR 0006 amendment, Option E).
  
  **@askdb/ai**: ships the four providers (moved unchanged from `@askdb/ai-*`) plus a new zero-dependency `gateway` provider for the Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model ids like `openai/gpt-4o-mini`). Each provider loads its AI SDK package lazily, the first time it builds a model. `@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`, and `@ai-sdk/anthropic` are now **optional peer dependencies**: install the one for the provider you configure. If it's missing, model creation fails with `Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`. The peer ranges are `^4.0.0` (the contract tests pass against 4.0.0), so a host on an older 4.x SDK isn't forced to upgrade. The lazy imports are written so esbuild builds without the SDKs a host didn't install. webpack 5 doesn't: see the webpack note under the deprecated packages below.
  
  - `createAiRegistry()` with no arguments registers every built-in provider. It also accepts built-in names and aliases (`createAiRegistry(["openai"])`), mixed freely with `AiProviderAdapter` objects. Custom adapters work unchanged.
  - New exports: `BUILTIN_AI_PROVIDERS` (one table of names, aliases, env vars, default models, and SDK packages), `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`, the adapters `openaiProvider` / `azureProvider` / `googleProvider` / `anthropicProvider` / `gatewayProvider`, and the `AiProviderSelector` type.
  - `aiProviderMissingMessage` now says to pass the built-in name to `createAiRegistry()` and to install `@ai-sdk/<provider>`, instead of naming an `@askdb/ai-*` package. `aiKeyMissingMessage` also lists the gateway.
  - The `gateway` provider maps reasoning effort through its upstream (`openai/`, `google/`, `anthropic/` model ids), sends embedding `dimensions` for `openai/` and `google/` models and refuses them for other upstreams, and rejects model ids without an `<upstream>/` prefix.
  - The `openai` provider now also sends `forceReasoning: true` with a reasoning effort, so an `@ai-sdk/openai` release that predates a model family (gpt-6 before 4.0.60) still sends it.
  - The built-in adapters' `createLanguageModel` / `createEmbeddingModel` are now `async`. The `AiProviderAdapter` contract already allowed promises, and `AiRegistry` methods were already async.
  
  **@askdb/ai-openai, @askdb/ai-azure, @askdb/ai-google, @askdb/ai-anthropic (deprecated)**: each now only re-exports its adapter from `@askdb/ai`, which it depends on directly (it was a peer). It keeps its `@ai-sdk/*` dependency, so existing installs and imports keep working, except in a webpack bundle. These packages will be removed before 1.0 (#347).
  
  **webpack users, including shim users who change nothing:** importing `@askdb/client`, `@askdb/ai`, or a shim now reaches every built-in provider's `import("@ai-sdk/<x>")`, and webpack 5 fails with `Module not found: Error: Can't resolve '@ai-sdk/google'` (and the other SDKs you don't have). Before this release, `@askdb/client` + `@askdb/ai-openai` bundled without the other SDKs. Install all four `@ai-sdk/*` packages, or mark the ones you don't use as `externals` (with ESM output, use `externalsType: "module"` and the bare package names):
  
  ```js
  // webpack.config.js: list the @ai-sdk/* packages you don't install.
  module.exports = {
    // ...
    externals: {
      "@ai-sdk/anthropic": "commonjs @ai-sdk/anthropic",
      "@ai-sdk/azure": "commonjs @ai-sdk/azure",
      "@ai-sdk/google": "commonjs @ai-sdk/google",
    },
  };
  ```
  
  A provider whose SDK isn't installed then fails at runtime with the install message. esbuild needs no change.
  
  To migrate:
  
  ```diff
  - npm i @askdb/ai-openai
  + npm i @askdb/ai @ai-sdk/openai
  
  - import { openaiProvider } from "@askdb/ai-openai";
  - const askdb = createAskDb({ config, providers: [openaiProvider] });
  + const askdb = createAskDb({ config }); // or providers: ["openai"]
  
  - const ai = createAiRegistry([openaiProvider]);
  + const ai = createAiRegistry(["openai"]);
  ```
  
  **@askdb/client**: `createAskDb({ config })` no longer throws when neither `providers` nor `registry` is passed. It registers every built-in `@askdb/ai` provider, and `ai.provider` in the config picks one. `providers` also accepts built-in names. The four `@ai-sdk/*` packages are declared as optional peers (`^4.0.0`) so strict installs such as Yarn Plug'n'Play pass the host's SDK through to `@askdb/ai`.
  
  **@askdb/config**: new `ai.provider: "gateway"` branch (`providerConfig.gateway.{apiKey, baseUrl, model}`, flattened to `AI_GATEWAY_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL`). `ASKDB_AI_PROVIDERS` includes `"gateway"`. `DEFAULT_ANTHROPIC_CHAT_MODEL`, `DEFAULT_GOOGLE_CHAT_MODEL`, and `DEFAULT_GATEWAY_CHAT_MODEL` are now exported. A test in `@askdb/client` (which depends on both) fails if this list, these defaults, or the env var names `flatten` writes drift from the built-in provider table. `askdb init` and Studio's setup wizard take each provider's default API key and model env var names from `@askdb/ai`'s provider table instead of keeping their own copies.
  
  **askdb, @askdb/http-api, @askdb/studio**: register providers with `createAiRegistry()` and depend on `@askdb/ai` plus all four `@ai-sdk/*` packages instead of `@askdb/ai-*`. They still work from env/config alone. `askdb init` and Studio setup now take their provider choices and scaffolded env var names from `@askdb/ai`'s table, and both offer the Vercel AI Gateway. Google now scaffolds `GOOGLE_AI_MODEL`, the variable the provider actually reads, instead of `GOOGLE_GENERATIVE_AI_MODEL`. Studio's "Get the code" snippet uses `@askdb/client` + `@ai-sdk/<provider>`. `askdb help init` lists every `--ai-provider` value, including `gateway`.
  
  **@askdb/rag**: the deprecation note on `createOpenAiEmbedder` now points at `createAiRegistry(["openai"])` instead of the `@askdb/ai-openai` adapter.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

### Patch Changes

- e57c734: Fix AI adapter correctness bugs that the AI SDK silently ignored.
  
  **@askdb/ai-azure**: Embedding `dimensions`/`user` are now sent. They were wrapped under `providerOptions.azure`, but `@ai-sdk/azure` builds embeddings with `OpenAIEmbeddingModel`, which reads only `providerOptions.openai`, so they were dropped. `reasoningEffort` now also sets `forceReasoning: true`. The AI SDK decides whether a model can reason from the model id it was given, which on Azure is the deployment name. Without this flag, a deployment such as `askdb-reporting` backed by `modelFamily: "gpt-5"` silently lost its reasoning effort. The missing-resource error now names the config keys (`ai.providerConfig.azure.resourceName` / `baseUrl`) and gives the `AZURE_RESOURCE_NAME` env alternative.
  
  **@askdb/ai-google**: Embeddings use the non-deprecated `google.embedding()` and now honor `dimensions`, mapped to Gemini's `outputDimensionality`.
  
  **@askdb/ai-openai / @askdb/ai-azure**: Reasoning-model detection no longer treats `gpt-5-chat*` (non-reasoning chat models) as reasoning models. It now recognizes gpt-5 point releases and later majors (`gpt-5.1`, `gpt-6`, …). gpt-6 and later accept `low` through `max` but not `minimal`, so a `minimal` effort is sent as `low` for them. This covers Azure deployments with a custom name and `modelFamily: "gpt-6"`, where the SDK can't see the family and would otherwise send `minimal`.
  
  **@askdb/ai-anthropic**: Reasoning-model detection now follows `@ai-sdk/anthropic`'s capability table. Claude Sonnet 4.6, Opus 4.6+, and the 5.x models (Opus 5, Sonnet 5, Fable 5, …) get adaptive thinking (`thinking: { type: "adaptive" }` plus `effort`) instead of the manual `budgetTokens` form, which newer models reject. Claude Haiku 4.5 now gets extended thinking.
  
  **@askdb/ai**: `aiKeyMissingMessage` now lists Anthropic. `aiProviderMissingMessage` maps aliases to the package that owns them (for example, `foundry` points to `@askdb/ai-azure`). It no longer suggests a nonexistent `@askdb/ai-<name>` package for custom providers. `withEmbeddingProviderOptions` takes an optional fourth argument that maps the portable `dimensions`/`user` options to a provider's own setting names; `@askdb/ai-google` now uses it instead of its own wrapper.
  
  **@askdb/config**: `AzureConfig` / `FoundryConfig` gain `resourceName`, which is flattened to the key the Azure adapter reads. Before this, a config-only Azure setup couldn't supply a resource name and failed at startup. `ASKDB_AI_PROVIDERS` now includes `"anthropic"`. New `@askdb/config/scaffold` entry point for tools that write a new `askdb.config.ts`: `renderAskDbAiConfigScaffold` renders its `ai` block and lists the env vars it reads, and `askdb init` and Studio's setup wizard both use it. The main entry is unchanged apart from `resourceName` and `ASKDB_AI_PROVIDERS`.
  
  **askdb / @askdb/studio**: `askdb init --ai-provider azure|foundry` and Studio's setup wizard (Azure OpenAI or Foundry) scaffold `resourceName: env("AZURE_RESOURCE_NAME")` and list `AZURE_RESOURCE_NAME` in `.env.example`, so the generated config works out of the box. `askdb init`'s `.env.example` now puts a one-line comment above each AI variable, and lists the SQLite file variable (`SQLITE_FILE` or the `--sqlite-file` env name) when the config reads one. It now also lists `DATABASE_URL` for `--database prisma --studio-execute` and `ASKDB_PGVECTOR_URL` for `--rag-store pgvector` without `--pgvector-env`, both of which the config read but `.env.example` left out, and lists each variable once. `--sqlite-file` now treats only an env-name-shaped value (`UPPER_SNAKE_CASE`) as a variable; a relative path such as `data.db` or `../db/app.db` is written as a literal path instead of `env("data.db")`.
- 11e2457: Restructure the `ai` config into provider connections plus a section per model, and stop a RAG key from reaching the wrong provider (#345, #435).
  
  **@askdb/config**: `ai.providerConfig.<provider>` now holds provider connections only (keys, endpoints, Azure resources, API versions), as one object or a list of named connections. The model choice moves to two sections, each with an optional `provider` and `connection`: `ai.language` (`model`, `modelFamily`, `reasoning`) and `ai.embedding` (`model`, `dimensions`), which `rag.embedder: "ai"` uses. The embedding model can come from a different provider than the language model, so an Anthropic setup can embed with OpenAI, and one provider can have two connections, such as two Azure resources. `ai.embedding.model` is required with `rag.embedder: "ai"`: AskDB no longer picks an embedding model for you. AskDB assumes no vector width: `ai.embedding.dimensions` is optional for every model and only requests a size from the provider. Unset, AskDB uses the width the model returns, learned when an index is built, so the pgvector store no longer needs a width in the config. A custom provider's connection is keyed by its provider id. The runtime config gains `ai.language`, `ai.embedding` (each with an `env` map built from that section's connection only) and `deprecations`. `ai.aiEnv` and the flat map's language keys are unchanged. Its `ASKDB_RAG_EMBEDDER*` keys follow the new shape: `ASKDB_RAG_EMBEDDER` is `"ai"` for the old `"openai"` and `"ai-sdk"`, `ASKDB_RAG_EMBEDDER_DIMENSIONS` holds only a configured width (or, for the mock embedder with the pgvector store, its 64), and `ASKDB_RAG_EMBEDDER_API_KEY` and `_BASE_URL` are no longer written, since the embedding key lives on its connection.
  
  Existing configs keep loading, apart from the cases listed below. Each old key is translated at load and reported once per process as a Node `DeprecationWarning` (code `ASKDB_CONFIG_DEPRECATED`) naming the old and new location, never the value: `providerConfig.<provider>.model` and Azure's `modelFamily` move to `ai.language`, `ai.reasoning` to `ai.language.reasoning`, `providerConfig.custom` to `providerConfig.<provider id>`, `rag.embedder: "openai" | "ai-sdk"` and `rag.embedderConfig.openai` to `rag.embedder: "ai"` plus `ai.embedding`, and `rag.storeConfig.pgvector.dimensions` (with an AI embedder) to `ai.embedding.dimensions`. With `rag.embedder: "mock"`, `rag.storeConfig.pgvector.dimensions` gets the same warning, saying it's ignored: the mock embedder's vectors are always 64 wide, as Studio already assumed. The old keys and the deprecated type aliases (`OpenaiConfig`, `OpenaiAiConfig`, …, `OpenaiRagEmbedderConfig`, `defaultRagEmbeddingDimensions`) are removed at 1.0.
  
  The key leak is fixed. A `rag.embedderConfig.openai.apiKey` or `.baseUrl` now moves to a connection of the embedding model's provider, and only when that provider is `openai`, `azure`, `foundry` or `gateway`; before, Studio sent the OpenAI key to the language model's provider (for example Google). The `askdb-rag` CLI's embedder settings no longer fall back to `ASKDB_AI_API_KEY` or `ASKDB_AI_BASE_URL`, so a custom provider's key or the gateway's URL no longer reaches OpenAI.
  
  These old-shape configs loaded before and now fail to load, each with an error that says what to change:
  
  - a `rag.embedderConfig.openai.apiKey` or `.baseUrl` whose embedding model would come from a provider other than `openai`, `azure`, `foundry` or `gateway` (the leak above);
  - `rag.embedder: "ai-sdk"` with no embedding model on a provider other than `openai`, `azure` or `foundry`, which asked that provider for `text-embedding-3-small`;
  - `rag.embedder: "ai-sdk"` with Anthropic as the language model's provider, which never embedded, since Anthropic has no embeddings API;
  - `rag.embedderConfig.openai.dimension` and `rag.storeConfig.pgvector.dimensions` set to different widths, where the pgvector value used to win silently;
  - an old key set next to its replacement: `ai.reasoning` with `ai.language.reasoning`, `ai.providerConfig.custom` with `ai.providerConfig.<provider id>`, or `rag.embedderConfig` with `ai.embedding`.
  
  **@askdb/rag**: New `detectEmbeddingDimensions(embedder)` learns an embedder's vector width by embedding one short text, so hosts don't have to hard-code a width. `createPgvectorStore`'s `dimensions` is now optional: it's needed only to create the table (`setupSql()`, or `ensureSchema()` when the table doesn't exist yet). The store gains `tableDimensions()`, and `ensureSchema()` now refuses an existing table whose width differs from `dimensions` with a `PgvectorDimensionMismatchError` (exported, with `table`, `tableDimensions` and `dimensions`), instead of keeping it and letting inserts fail partway through indexing. `buildSchemaIndex` records the width of the vectors it wrote in the lock file's `dimensions`.
  
  **@askdb/ai**: `ProviderEnvSpec.defaultEmbeddingModel` is deprecated. When an env map names no embedding model, `openai`, `azure` and `gateway` still fall back to their default, now with a one-time `DeprecationWarning` (code `ASKDB_AI_DEFAULT_EMBEDDING_MODEL`); the fallback is removed at 1.0. Configs never reach it, since `ai.embedding.env` always names the model. The "no embedding model" error points at `ai.embedding.model`, and the gateway and Anthropic messages name `ai.embedding` instead of the old `rag` keys.
  
  **@askdb/studio**: RAG embeds through the `ai.embedding` section's connection only. Settings shows the active embedder, the workspace reports the configured language model instead of a hard-coded `gpt-4o-mini`, and a RAG failure names the section, provider, connection and model. Studio no longer assumes a vector width. With pgvector, the first index build asks the embedding model for its width (one short embedding call) and creates the table at that width; an existing table of another width is refused with a 409 before any chunk is embedded, and the message names the table and how to resolve it: drop it and build again, point `rag.storeConfig.pgvector.table` at a new table, or set `ai.embedding.dimensions` to the table's width. The status page no longer creates the table, and shows the width recorded at the last build. Index ids carry a width only when `ai.embedding.dimensions` sets one, so an existing index built without one shows as stale once: rebuild it, or, for an old-shape config, set the width the deprecation warning names to keep it. Setup writes the new shape.
  
  **askdb**: `askdb init` writes the model to `ai.language.model` and no longer writes `rag.embedderConfig: {}`.
- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- d6e52ed: `askdb bundle` now includes `tenant-policy.md` in the bundle (via `@askdb/enrich`). Bundles built with `askdb` 1.0.0-beta.43 or earlier left the tenant policy out, so a multi-tenant schema loaded from one of them came up with no policy, and `ask()` neither required a `tenantScope` nor injected tenant predicates. Rebuild every bundle made from a schema directory that has a `tenant-policy.md`, then check that `loadSchema(bundlePath).tenantPolicy` is defined.
- c610168: **CLI: `--help` / `--version` work without a config; friendly missing-config error.**
  
  - `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
  - `askdb --version` / `-V` is now supported and prints the package version.
  - When a command needs config and none exists, the CLI prints `No askdb.config.* or .config/askdb.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors (for example a config that fails to load) print their message and a hint; set `ASKDB_DEBUG=1` (or `true`) to include the stack trace. Other values, including `0`, and the `debug` package's `DEBUG` variable leave it off.
  - `askdb studio` / `askdb enrich` warn when `askdb.config.*` exists but fails to load, instead of ignoring it silently.
  
  **Docs:** the `@askdb/core` README states the pre-release beta status accurately.
- 224a05b: `askdb ask` leaves config `modes.omitSensitiveFromPrompt` to the `@askdb/client` facade, which now treats it as a floor, instead of OR-ing it with `--omit-sensitive-from-prompt` itself. No behavior change.
- 440054a: Move the connector provider registry into `@askdb/introspect` with open provider ids. Engine adapters now own connection resolution, and the CLI and Studio per-engine switches are gone (ADR 0008).
  
  - **@askdb/introspect**:
    - New root exports: `createConnectorRegistry`, `ConnectorProviderAdapter`, `ConnectorProviderAdapters`, `ConnectorConfig`, `ConnectorResult`, `ConnectorRegistry`, `ConnectorConnection`, `ConnectorConnectionRequest`, `ConnectorConnectionResult`, `ConnectorConnectionResolution`, `ConnectorRuntimeConfig`, `ConnectorProviderId`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS`, `BuiltInConnectorProvider`.
    - Provider ids are typed `ConnectorProviderId = BuiltInConnectorProvider | (string & {})`, so a third-party engine can register its own id.
    - Adapters can implement `resolveConnection({ explicit?, runtime, surface? })`, which merges explicit values (CLI flags) with AskDB runtime config into `{ url?, fromExport?, schemaPath? }` (or an error). The registry adds `sourceLabel`, built from the adapter's `connectionLabelParts` with `formatConnectionLabel`, so no adapter supplies label text.
    - The registry exposes `resolveConnection(provider, request)`, `connectionLabel(provider, connection)` and `providers()`. `resolveConnection` treats a blank explicit value (empty or whitespace-only) as absent, so the configured connection applies. An adapter without `connectionLabelParts` is labeled `configured <provider> connection`.
    - `createConnectorRegistry()` throws when two adapters use the same provider id, instead of silently keeping the last one.
    - `@askdb/introspect/kit` adds `defineLiveConnectorProvider` for live-catalog-only engines (with `LiveConnectorProviderSpec`, `LiveCatalogInput`, and an optional `fromExportUnsupported` message, defaulting to `--from-export is not supported for --engine <id>.`), and `runtimeIntrospectionString(runtime, key)` for reading `runtime.introspection`.
  - **@askdb/connectors**: deprecated. It is now a re-export shim of the `@askdb/introspect` registry and the `@askdb/introspect/kit` connection-label helpers. `CONNECTOR_PROVIDERS` aliases `BUILT_IN_CONNECTOR_PROVIDERS`. `ConnectorProvider` aliases `ConnectorProviderId` and is now an open string type instead of a closed union. Migrate imports to `@askdb/introspect`.
  - **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**:
    - Each provider adapter now implements `resolveConnection`. The logic and error messages are ported from the CLI and Studio. The label keeps coming from each adapter's `connectionLabelParts`; with no schema path, the Prisma label is now `configured prisma connection` (it was the fixed text `auto-discovered prisma/schema.prisma`).
    - The adapters now take their types from `@askdb/introspect`, and the `@askdb/connectors` dependency is dropped. Their exported adapter's `provider` type widens from the closed five-id union to `ConnectorProviderId`, a type-level change, hence minor.
    - MySQL, SQLite, and SQL Server adapters are built with `defineLiveConnectorProvider`.
  - **askdb**:
    - `askdb introspect` resolves `--engine` and connections through the registry, with no per-engine switch.
    - Flag and config precedence and error messages are unchanged. The one exception: `askdb introspect templates --engine prisma` now prints the generic "does not provide SQL templates" error.
    - Drops the `@askdb/connectors` dependency.
  - **@askdb/studio**:
    - The server-side introspection plan and run, and the source label, dispatch through the registry, with no per-engine switch.
    - Messages are unchanged. The one visible change: a Prisma connection with no schema path is labelled `configured prisma connection` (it was `auto-discovered prisma/schema.prisma`).
    - Drops the `@askdb/connectors` dependency.
- ce8d837: `ask()` keeps a model's single trailing `;` in the SQL it returns instead of removing it, so `sql` is the statement the model wrote. `validateSelectSql` returns the SQL trimmed and otherwise as written, including the `;` and any whitespace before it; `unboundSql`, `preparedQuery.namedSql` and `bindPreparedQuery`'s `sql` and `unboundSql` keep the `;` of the model block they come from. The single-statement check is unchanged: any `;` other than one trailing `;` still throws `SQL_MULTI_STATEMENT`, and a dialect's `extraValidate` still runs on the statement without it.
  
  If you wrap the SQL, remove the `;` first: `SELECT * FROM (${sql}) AS q LIMIT 1000` is a syntax error on every engine when `sql` ends in `;`. The [Row limits](https://askdb.tools/guides/run-safely-in-prod/#row-limits) guide now does this with `sql.replace(/;$/, "").trimEnd()`. Studio's Playground **Execute** removes it before its row cap. `askdb ask` prints the SQL as `ask()` returned it, instead of adding a `;` of its own, which printed `;;` for a reply that ends in one.
- c55bfb3: Fix `askdb introspect --diff` reporting `changed: true` against an untouched artifact.
  
  `--diff` rendered its comparison body with `toV2SchemaJson(schema, schemaId)`, which dropped the connector-detected `provider` that `--out` writes, and it skipped the ID-anchored merge, so human-set `sensitive` flags in the existing `schema.json` also showed up as drift. In practice `--diff` said "changed" almost every time.
  
  **@askdb/introspect**: new pure `renderSchemaV2Body(schema, { schemaId, provider?, existingArtifactDir? })` returns `{ json, body, warnings }` — the exact bytes `renderToSchemaV2` writes, including the merge with an existing artifact. `renderToSchemaV2` now writes through it. New `isSchemaV2Json(value)` is the check applied to an existing `schema.json` before that merge: the shape the merge reads, including that each `sensitive` flag is a boolean when present, so a non-boolean flag is no longer copied into the new artifact.
  
  **askdb**: `--out`, `--print` and `--diff` all render through `renderSchemaV2Body`. `--diff` passes the connector's `provider` and merges with the existing artifact when the renderer accepts it as valid Schema v2 (an invalid `schema.json`, such as `{ "version": 2 }` with no tables, is compared without the merge and reported as changed, as before; any other merge error, such as malformed `tables/*.md` front matter, fails `--diff` the way it fails `--out`), and compares structurally so a key-reordered but equivalent file is not reported as changed.
- 3ad781b: Make the `rag` block optional in `AskDbConfig` (#226).
  
  **@askdb/config**: `rag` may now be omitted, and omitting it means `{ embedder: "mock", store: "memory" }`, which writes only `ASKDB_RAG_EMBEDDER=mock`. A config that sets `ai.embedding` but has no `rag` block fails to load, with an error saying to add `rag: { embedder: "ai", … }`. Existing configs are unaffected and flatten to the same keys. Breaking for TypeScript: `AskDbConfig["rag"]` is now optional, so code reading `config.rag` or `getAskDbRuntimeConfig().structured.rag` needs a check. The runtime config gains `rag.store` and `rag.storeConfig`, defaulted when the block is omitted (`storeConfig` is `{}` when the block has none); read those instead.
  
  **@askdb/studio**: RAG reads the store from `getAskDbRuntimeConfig().rag`, so a config without a `rag` block opens RAG with the in-memory store and the mock embedder.
  
  **askdb**: `askdb rag` reads its store fallbacks from `getAskDbRuntimeConfig().rag`, so a config without a `rag` block runs on the in-memory store and the mock embedder.
- fa2e771: Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.
- Updated dependencies [e57c734]
- Updated dependencies [11e2457]
- Updated dependencies [e7ea657]
- Updated dependencies [f506c14]
- Updated dependencies [e511e16]
- Updated dependencies [c610168]
- Updated dependencies [b01f9fc]
- Updated dependencies [c6e289a]
- Updated dependencies [0009bb1]
- Updated dependencies [b01f9fc]
- Updated dependencies [9847a87]
- Updated dependencies [1825d01]
- Updated dependencies [440054a]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [194de19]
- Updated dependencies [a8be801]
- Updated dependencies [c55bfb3]
- Updated dependencies [1ca3eba]
- Updated dependencies [c55bfb3]
- Updated dependencies [bc81653]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
- Updated dependencies [3ad781b]
- Updated dependencies [c55bfb3]
- Updated dependencies [87b7da6]
- Updated dependencies [c40876a]
- Updated dependencies [c55bfb3]
- Updated dependencies [cca5656]
- Updated dependencies [ad0b170]
- Updated dependencies [01f289a]
- Updated dependencies [a62205d]
- Updated dependencies [b668070]
- Updated dependencies [f2f6239]
- Updated dependencies [fa2e771]
- Updated dependencies [7a0f777]
- Updated dependencies [c55bfb3]
- Updated dependencies [5d3a38b]
- Updated dependencies [c55bfb3]
- Updated dependencies [e88067d]
- Updated dependencies [5e6b9fd]
  - @askdb/ai@0.1.0-beta.8
  - @askdb/config@1.0.0-beta.13
  - @askdb/studio@0.2.0-beta.37
  - @askdb/rag@0.2.0-beta.24
  - @askdb/core@1.0.0-beta.44
  - @askdb/client@1.0.0-beta.7
  - @askdb/postgres@0.2.0-beta.20
  - @askdb/mysql@0.1.0-beta.19
  - @askdb/sqlserver@0.1.0-beta.20
  - @askdb/sqlite@0.1.0-beta.19
  - @askdb/prisma@0.2.0-beta.18
  - @askdb/introspect@0.3.0-beta.18
  - @askdb/enrich@0.2.0-beta.15

## 1.0.0-beta.43

### Minor Changes

- 5dbe2d6: **MySQL/MariaDB: introspect several databases at once.**

  **@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

  **@askdb/config**: New `introspection.schemas?: string[]`, the config equivalent of `askdb introspect --schemas`, for every provider (on MySQL/MariaDB, the databases to introspect). Runtime config exposes it as `introspection.schemas`.

  **askdb**: `askdb introspect` reads `introspection.schemas` from config for any engine; `--schemas` overrides it.

  **@askdb/studio**: Resync passes the configured schema list to the connector, so it matches `askdb introspect`.

- cc176d1: Breaking (pre-1.0, so a minor bump):

  - Require Node `>=22.12` consistently: `askdb`, `@askdb/http-api`, and `@askdb/studio` previously declared `>=22`, but the libraries they depend on already required `>=22.12`.
  - `@askdb/http-api` and `@askdb/studio` now declare an `exports` map: `.` (the package entry) and `./package.json`. Deep imports of other files, such as `@askdb/studio/dist/server.js`, are no longer allowed; import from the package entry instead.

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 5e89384: **@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) now opens by calling the check a best-effort lint, and says it is not a SQL parser and not a security boundary, with real tenant isolation coming from the database, and that `global` scope skips it. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

  **@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

  **askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.

- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- 933bd6c: **@askdb/studio** (security): Playground execute is now opt-in, runs one read-only statement at a time, and has a timeout and a row cap.

  - **Off by default.** `POST /api/execute` returns `403` with setup instructions until `studio.execute.enabled: true` is set. The Playground hides the Execute button and shows why. `/api/execute/status` now reports `enabled`, `disabledReason`, `timeoutMs`, and `maxRows`.
  - **No silent credential reuse.** Execute no longer falls back to the introspection connection. Set `studio.execute.databaseUrl` / `file`, ideally for a read-only role, or opt in with `studio.execute.useIntrospectionConnection: true`. This is a breaking change for projects that relied on the fallback.
  - **Validated before execution.** Every query must pass `@askdb/core`'s `validateSelectSql` for the execute engine's dialect. Otherwise the request fails with `400` and never reaches the driver. SQL that reads `sensitive` columns returns `warnings`.
  - **One read-only statement.** Postgres forces the extended query protocol, so `SELECT 1; COMMIT; DROP …` can no longer escape `BEGIN READ ONLY`, and turns on `default_transaction_read_only`. MySQL and MariaDB use a prepared statement in `START TRANSACTION READ ONLY`. SQL Server runs inside `SET XACT_ABORT ON; BEGIN TRANSACTION … ROLLBACK`. SQL Server has no read-only mode, so use a read-only login.
  - **Timeouts and row caps.** Queries time out after 30 s by default (`studio.execute.timeoutMs`; not enforced for SQLite). Studio fetches at most `studio.execute.maxRows + 1` rows (default 500) and reports `truncated` and `rowLimit`, instead of loading every row and slicing.
  - **Bounded requests.** JSON bodies over 1 MiB return `413`. Playground history keeps only known fields with length limits. Studio adds `playground-history.json` to the schema directory's `.gitignore`, creating the file with `.env` rules if it doesn't exist.
  - **Driver install.** Inherited keys such as `constructor` are rejected with `400`, and installs now work on Windows. The setup wizard and install endpoint share one package-manager spawn helper.
  - The setup wizard now defaults Studio execute to off, and choosing it writes `enabled: true`.

  **@askdb/config**: New `studio.execute` fields, each with a canonical flat key: `enabled` (`ASKDB_STUDIO_EXECUTE_ENABLED`, default `false`), `useIntrospectionConnection` (`ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION`, default `false`), `timeoutMs` (`ASKDB_STUDIO_EXECUTE_TIMEOUT_MS`, default `30000`), and `maxRows` (`ASKDB_STUDIO_EXECUTE_MAX_ROWS`, default `500`). The runtime `studio.execute.databaseUrl` / `file` no longer fall back to the introspection connection unless `useIntrospectionConnection` is `true`. Also exports `DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS` and `DEFAULT_STUDIO_EXECUTE_MAX_ROWS`.

  **askdb**: `askdb init` writes `enabled: true` in the `studio.execute` block when you choose Studio execute. The interactive wizard now defaults that choice to off, matching `--studio-execute`'s documented default.

- 2a21161: **@askdb/studio** (security): The local API now rejects requests from other websites in your browser, closing a cross-site request and DNS-rebinding hole that let any open web page run SQL through `/api/execute` or rewrite schema files.

  - Every request must send an allowed `Host`: `localhost`, `127.0.0.1`, `[::1]`, or the bound host (for `0.0.0.0` binds, this machine's own IP addresses), on Studio's own port.
  - Every `/api/*` call must send the per-launch session token that Studio injects into the page it serves, as the `x-askdb-studio-token` header.
  - State-changing calls must be same-origin, and requests with a body must use `Content-Type: application/json`.

  The web app now shows the HTTP status instead of a JSON parse error when a failed API request returns a non-JSON body (a proxy error page or an empty 502); server-provided error messages are still shown as before. Binding to a non-loopback host now prints a startup warning. `createStudioServer()` returns the token as `server.sessionToken` for programmatic callers. This is a breaking change for any client that called the API without it. The setup wizard's `askdb.config.ts` writer now emits every value with `JSON.stringify`, rejects control characters in paths, and validates the execute provider. Previously, a crafted path could inject code that ran when Studio loaded the config.

  **askdb**: `askdb init` escapes every value it writes into `askdb.config.ts` the same way, so quotes or backslashes in `--schema-out`, `--sqlite-file`, `--prisma-schema`, or env-name flags can no longer break out of their string literals.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [5dbe2d6]
- Updated dependencies [cc176d1]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [2a21161]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/studio@0.2.0-beta.36
  - @askdb/enrich@0.2.0-beta.14
  - @askdb/ai-anthropic@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.7
  - @askdb/ai-google@1.0.0-beta.7
  - @askdb/ai-openai@1.0.0-beta.7
  - @askdb/ai@0.1.0-beta.7
  - @askdb/client@1.0.0-beta.6
  - @askdb/config@1.0.0-beta.12
  - @askdb/connectors@0.1.0-beta.8
  - @askdb/introspect@0.3.0-beta.17
  - @askdb/mysql@0.1.0-beta.18
  - @askdb/postgres@0.2.0-beta.19
  - @askdb/prisma@0.2.0-beta.17
  - @askdb/sqlite@0.1.0-beta.18
  - @askdb/sqlserver@0.1.0-beta.19

## 1.0.0-beta.42

### Patch Changes

- 1af6263: **@askdb/core**: promote the sensitive-identifier SQL check out of the CLI into core as a public, enforceable API, and fix its false-positive problem.

  New export `validateSensitiveReferences(sql, schema, options?)` reports the `sensitive` tables and columns a SQL statement references, returning `{ passed, references, unresolvedScope? }` — the same shape as `TenantGuardrailResult`. Each reference carries `matchKind: "qualified" | "unqualified" | "table"`. `{ mode: "strict" }` throws the new `SensitiveReferenceError extends AskDbError` with a `SensitiveReferenceRuleCode`; `{ mode: "warn" }` (the default) returns without throwing.

  `sensitive: true` was previously prompt-level only — `formatSchemaForNlToSql` tags or withholds identifiers, which constrains what the model _sees_ but not SQL that reaches execution by another route (a host SQL cache, a replayed statement, a regenerated artifact). `validateSensitiveReferences` is the enforcement path and is exported standalone so it can run on stored SQL with no model in the loop.

  **Fixes the unqualified matcher.** The CLI's private implementation regex-tested each sensitive column name anywhere in the statement, so any table-level-`sensitive` table with a common column (`id`, `name`, `tag`) flagged every benign query. Unqualified names now count only when the owning table is actually in the statement's scope: `FROM`/`JOIN` targets and their aliases are resolved first, including inside CTEs and derived tables, and string literals and comments are excluded. When scope cannot be proven the check fails conservatively and says why via `unresolvedScope`, mirroring how `validateTenantGuardrails` handles unprovable scope.

  `ask()` runs the guardrail over the SQL it returns and attaches `AskPipelineResult.sensitiveGuardrail`; the new `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default — not a breaking change), `"strict"`, or `"off"`. Reuses the existing `askdb.pipeline.sensitive_sql_warning` log event, now exposed as `AskDbLogEvent.PipelineSensitiveSqlWarning`. Also exports `schemaHasSensitiveIdentifiers` and `formatSensitiveReference`.

  **askdb**: `askdb ask` now renders the guardrail result from `ask()` instead of its own private copy of the check, so there is one implementation. The warning no longer fires on unrelated queries that merely share a column name with a sensitive table, and schema-qualified schemas now print `schema.table.column`. Unresolvable statement scope is surfaced as a `Note:` line.

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
- Updated dependencies [5781271]
  - @askdb/core@1.0.0-beta.42
  - @askdb/ai@0.1.0-beta.6
  - @askdb/ai-anthropic@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.6
  - @askdb/ai-google@1.0.0-beta.6
  - @askdb/ai-openai@1.0.0-beta.6
  - @askdb/client@1.0.0-beta.5
  - @askdb/config@1.0.0-beta.11
  - @askdb/connectors@0.1.0-beta.7
  - @askdb/enrich@0.2.0-beta.13
  - @askdb/introspect@0.3.0-beta.16
  - @askdb/mysql@0.1.0-beta.17
  - @askdb/postgres@0.2.0-beta.18
  - @askdb/prisma@0.2.0-beta.16
  - @askdb/sqlite@0.1.0-beta.17
  - @askdb/sqlserver@0.1.0-beta.18
  - @askdb/studio@0.2.0-beta.35

## 1.0.0-beta.41

### Minor Changes

- 0c62b25: Upgrade the Vercel AI SDK integration to AI SDK 7.

  This moves `ai` to `^7.0.51` and the first-party provider packages to their AI SDK 7-compatible majors:

  - `@ai-sdk/openai` `^4.0.29`
  - `@ai-sdk/anthropic` `^4.0.29`
  - `@ai-sdk/google` `^4.0.33`
  - `@ai-sdk/azure` `^4.0.30`

  AI SDK 7 requires Node.js 22 or newer, so AskDB packages that expose or carry the AI SDK runtime now advertise `node >=22`. Core model calls now use the AI SDK 7 `instructions` option, and the Google adapter uses the renamed `createGoogle` provider factory.

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/ai@0.1.0-beta.5
  - @askdb/ai-openai@1.0.0-beta.5
  - @askdb/ai-google@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.5
  - @askdb/ai-anthropic@1.0.0-beta.3
  - @askdb/core@1.0.0-beta.41
  - @askdb/config@1.0.0-beta.10
  - @askdb/client@1.0.0-beta.4
  - @askdb/studio@0.2.0-beta.34
  - @askdb/enrich@0.2.0-beta.12
  - @askdb/introspect@0.3.0-beta.15
  - @askdb/mysql@0.1.0-beta.16
  - @askdb/postgres@0.2.0-beta.17
  - @askdb/sqlite@0.1.0-beta.16
  - @askdb/sqlserver@0.1.0-beta.17
  - @askdb/connectors@0.1.0-beta.6
  - @askdb/prisma@0.2.0-beta.15

## 1.0.0-beta.40

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/studio@0.2.0-beta.33
  - @askdb/client@1.0.0-beta.3
  - @askdb/enrich@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.14
  - @askdb/mysql@0.1.0-beta.15
  - @askdb/postgres@0.2.0-beta.16
  - @askdb/sqlite@0.1.0-beta.15
  - @askdb/sqlserver@0.1.0-beta.16
  - @askdb/connectors@0.1.0-beta.5
  - @askdb/prisma@0.2.0-beta.14

## 1.0.0-beta.39

### Patch Changes

- 84069cf: Drop dotenv from generated config; use DATABASE_URL universally; generate .env.example with placeholder connection strings.

  `askdb init` and the Studio setup wizard no longer emit `import dotenv` or install `dotenv` explicitly — `bootstrapAskDbEnv()` already loads `.env` before evaluating the config file, and `dotenv` is already a transitive dependency of `@askdb/config`.

  All network database providers (postgres, mysql, sqlserver) now default to `DATABASE_URL` instead of provider-specific names like `MYSQL_URL` or `SQLSERVER_URL`.

  Both `askdb init` and the Studio wizard now generate a `.env.example` alongside `askdb.config.ts`, pre-populated with a ready-to-copy placeholder connection string in the correct format for the selected database (postgresql:// URI, mysql:// URI, or MSSQL ADO.NET connection string).

- Updated dependencies [84069cf]
  - @askdb/studio@0.2.0-beta.32

## 1.0.0-beta.38

### Patch Changes

- 5acd920: **@askdb/studio**: the guided setup wizard reaches parity with `askdb init` — it now also asks for the AI model env var, RAG store (file/memory/pgvector), Studio execute config, and supports the Azure AI Foundry provider. Env var _name_ fields (connection URL, AI key, AI model, pgvector, Studio execute connection) render as a pre-filled default and only become editable when clicked, instead of always showing an open text input. Fixes a bug where writing a config with `ragStore: "pgvector"` before `.env` was filled in returned a 500.

  **askdb**: `askdb init`'s interactive wizard no longer prompts you to name env vars — it uses conventional defaults (`DATABASE_URL`, `OPENAI_API_KEY`, ...) and tells you in the summary/next-steps output that you can rename any `env("...")` call in the generated `askdb.config.ts` afterward.

- Updated dependencies [5acd920]
  - @askdb/studio@0.2.0-beta.31

## 1.0.0-beta.37

### Minor Changes

- 857fd50: Retire the `@askdb/tui` terminal authoring surface in favor of Studio.

  Studio (`askdb studio`) is a strict superset of the TUI for Schema v2
  enrichment and has been the documented authoring surface since the
  studio-first onboarding work. The `@askdb/tui` package is removed from the
  workspace:

  - `askdb enrich` now opens Studio (prints a one-line retirement notice and
    forwards arguments such as `--schema`).
  - `askdb bundle <dir> --out <file>` now calls `@askdb/enrich` directly; the
    command was always headless and no longer routes through a UI package.
  - The `askdb-tui` binary is no longer published.

  All shared authoring logic (workspace loading, drafts, frontmatter
  round-tripping, bundling, suggestion targets) already lives in
  `@askdb/enrich`, so no enrichment behavior changes.

## 1.0.0-beta.36

### Patch Changes

- Updated dependencies [7311ac5]
- Updated dependencies [fa690a3]
- Updated dependencies [162c33b]
- Updated dependencies [b7f70b6]
- Updated dependencies [56920c8]
- Updated dependencies [7311ac5]
  - @askdb/client@1.0.0-beta.3
  - @askdb/studio@0.2.0-beta.30
  - @askdb/ai@0.1.0-beta.4
  - @askdb/ai-openai@1.0.0-beta.4
  - @askdb/ai-anthropic@1.0.0-beta.2
  - @askdb/ai-google@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.4
  - @askdb/core@1.0.0-beta.36
  - @askdb/tui@0.2.0-beta.17
  - @askdb/introspect@0.3.0-beta.13
  - @askdb/mysql@0.1.0-beta.14
  - @askdb/postgres@0.2.0-beta.15
  - @askdb/sqlite@0.1.0-beta.14
  - @askdb/sqlserver@0.1.0-beta.15
  - @askdb/connectors@0.1.0-beta.4
  - @askdb/prisma@0.2.0-beta.13

## 1.0.0-beta.35

### Patch Changes

- 45fef02: **@askdb/studio**: Studio is now a viable front door for a brand-new project.

  - **Guided setup wizard.** `askdb studio` (or `askdb-studio`) in a directory with no `askdb.config.*` or no schema artifact no longer errors out — Studio starts in setup mode and the browser walks you through it: pick a database engine and AI provider (env var _names_ only — secret values stay in `.env`, which the wizard tells you to create), Studio writes `askdb.config.ts` and `.env.example`, then runs introspection server-side and opens the Overview. New endpoints: `GET /api/setup/status`, `POST /api/setup/config`, `POST /api/setup/introspect` (config write and introspection are loopback-only). Passing an explicit `--schema` that doesn't exist still fails fast.
  - **"Resync schema" now works.** The Overview button (previously a no-op) re-runs introspection server-side using the connection from `askdb.config.ts` — same engine resolution as `askdb introspect` with no flags — and reloads the workspace. Enrichment markdown is preserved, exactly like the CLI path. New endpoints: `GET /api/introspect/status` (plan preview with credential-redacted source), `POST /api/introspect` (loopback-only).
  - **"Get the code" panel in the Playground.** Below the generated SQL, Studio renders the exact integration snippet for the current workspace — your question, schema path, resolved dialect, configured provider, and (when enabled) the tenant scope — in two styles: config-driven `createAskDb()` from `@askdb/client`, or direct `ask()` from `@askdb/core`. Copy-paste it into a Node service and it runs against the same config Studio uses.
  - `StudioWorkspaceDto` gains `dialect` and `schemaPathRelative`.

  **askdb**: `askdb studio` no longer aborts when no `askdb.config.*` exists — it starts Studio in setup mode so the browser wizard can scaffold the project. All other commands still require a config.

- Updated dependencies [45fef02]
  - @askdb/studio@0.2.0-beta.29

## 1.0.0-beta.34

### Patch Changes

- Updated dependencies [a30643a]
  - @askdb/studio@0.2.0-beta.28

## 1.0.0-beta.33

### Patch Changes

- Updated dependencies [5affd84]
  - @askdb/postgres@0.2.0-beta.14
  - @askdb/mysql@0.1.0-beta.13
  - @askdb/sqlite@0.1.0-beta.13
  - @askdb/sqlserver@0.1.0-beta.14
  - @askdb/studio@0.2.0-beta.27

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [9689c3a]
  - @askdb/studio@0.2.0-beta.26

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [e6caf41]
  - @askdb/sqlserver@0.1.0-beta.13

## 1.0.0-beta.30

### Minor Changes

- 6b22dcb: feat(cli): `askdb init` is now a setup wizard that writes a tailored config and installs selected packages

  - In a TTY, `askdb init` opens a short interactive wizard (powered by `@inquirer/prompts`, lazy-loaded) that asks which database, AI provider, RAG store, and Studio execute mode you want. It then generates only the relevant config branches and installs only the packages for your chosen path.
  - In CI and scripts, `askdb init --yes` runs silently with Postgres + OpenAI defaults. All wizard choices are also available as flags (`--database`, `--ai-provider`, `--rag-store`, `--studio-execute`, etc.).
  - The generated `askdb.config.ts` includes only the selected `introspection.providerConfig` branch, the selected AI `providerConfig` branch, and the selected RAG `storeConfig` branch — no more deleting unused sections.
  - The install plan is exact: SQL Server setups install `mssql`; SQLite setups install `better-sqlite3`; Prisma-only setups install no live DB driver unless Studio execute is enabled.
  - `@inquirer/prompts` is added as a runtime dependency but is only imported when entering interactive mode.

### Patch Changes

- dc380bc: Remove direct `pg` runtime dependencies from bundled app surfaces and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.
- Updated dependencies [dc380bc]
- Updated dependencies [dc380bc]
  - @askdb/postgres@0.2.0-beta.13
  - @askdb/mysql@0.1.0-beta.12
  - @askdb/sqlite@0.1.0-beta.12
  - @askdb/sqlserver@0.1.0-beta.12
  - @askdb/studio@0.2.0-beta.25
  - @askdb/config@1.0.0-beta.9
  - @askdb/client@1.0.0-beta.2
  - @askdb/tui@0.2.0-beta.16

## 1.0.0-beta.29

### Patch Changes

- 354c833: Resolve schema, model, and dialect via the new `@askdb/client` facade instead of duplicating the logic in each host. No behavior change: same dialect precedence, mock-SQL path, and error responses.
- Updated dependencies [354c833]
- Updated dependencies [354c833]
  - @askdb/client@0.1.0-beta.1

## 1.0.0-beta.27

### Minor Changes

- d4a0a1d: Add Anthropic Claude as a supported AI provider, open the config provider union for custom adapters, and make the key-missing message registry-driven.

  **New package: `@askdb/ai-anthropic`** — Set `ASKDB_AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Anthropic Claude models. The default model is `claude-sonnet-4-6`; override with `ASKDB_AI_MODEL` or `ANTHROPIC_MODEL`. The `anthropic` provider is also configurable via `askdb.config.*` using the new `providerConfig.anthropic` branch (`apiKey`, `model`, `baseUrl`). Anthropic has no embeddings API; `createEmbeddingModel` throws a clear error directing you to configure a separate embedding provider.

  **Registry-driven key-missing message (`@askdb/ai`)** — `AiProviderAdapter` gains an optional `configHint` field. `AiRegistry` gains `keyMissingMessage(context)` that assembles hints from all registered adapters (deduplicated across aliases, stable registration order). The static `aiKeyMissingMessage` export is deprecated in favor of `ai.keyMissingMessage(context)`. All four surfaces (CLI, HTTP API, Studio, TUI) now use the registry method so Anthropic (and any future adapter) is automatically mentioned.

  **Custom provider config branch (`@askdb/config`)** — `AskDbAiConfig` now accepts any provider string, not just the four known literals. Known literals still get dedicated branches with required `providerConfig`; any other string falls through to the new `CustomAiConfig` branch, which flattens to the universal `ASKDB_AI_*` env keys. Custom providers only work end to end when the host registry contains an adapter registered under that provider name — the first-party apps register only first-party adapters.

- 4dd7a59: Make AI provider adapters self-describing. Standalone `resolveAiConfig` and
  `resolveEmbeddingConfig` moved onto `createAiRegistry()` registry instances, and
  adapters now own their native env vars, aliases, defaults, and provider-specific
  connection options.

  `AiConfig.resourceName` and `AiConfig.apiVersion` were replaced by
  `AiConfig.providerOptions`; Azure reads `resourceName` and `apiVersion` from
  that bag. The `ai` package is now a peer dependency of `@askdb/ai` and all
  first-party AI adapter packages.

  Google behavior is now provider-correct: it no longer falls back to
  `OPENAI_API_KEY_SECONDARY`, its default language model is `gemini-2.0-flash`,
  and embeddings require an explicit Google embedding model instead of falling
  back to OpenAI's `text-embedding-3-small`.

### Patch Changes

- c0603e1: Resolve the runtime introspection output directory through `@askdb/config` and use it when **`askdb ask`** omits **`--schema`**. Pass **`--schema <path>`** to override.
- Updated dependencies [d4a0a1d]
- Updated dependencies [4dd7a59]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
- Updated dependencies [96e6963]
  - @askdb/ai-anthropic@1.0.0-beta.1
  - @askdb/ai@0.1.0-beta.3
  - @askdb/config@1.0.0-beta.8
  - @askdb/studio@0.2.0-beta.24
  - @askdb/tui@0.2.0-beta.15
  - @askdb/ai-openai@1.0.0-beta.3
  - @askdb/ai-azure@1.0.0-beta.3
  - @askdb/ai-google@1.0.0-beta.3

## 1.0.0-beta.26

### Patch Changes

- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
- Updated dependencies [baf5ad8]
- Updated dependencies [999ba36]
- Updated dependencies [baf5ad8]
  - @askdb/ai@0.1.0-beta.2
  - @askdb/ai-openai@0.1.0-beta.2
  - @askdb/ai-azure@0.1.0-beta.2
  - @askdb/studio@0.2.0-beta.23
  - @askdb/ai-google@0.1.0-beta.2
  - @askdb/core@1.0.0-beta.26
  - @askdb/mysql@0.1.0-beta.11
  - @askdb/postgres@0.2.0-beta.12
  - @askdb/tui@0.2.0-beta.14
  - @askdb/introspect@0.3.0-beta.12
  - @askdb/sqlite@0.1.0-beta.11
  - @askdb/sqlserver@0.1.0-beta.11
  - @askdb/connectors@0.1.0-beta.3
  - @askdb/prisma@0.2.0-beta.12

## 1.0.0-beta.25

### Patch Changes

- Updated dependencies [8371033]
  - @askdb/studio@0.2.0-beta.22

## 1.0.0-beta.24

### Patch Changes

- Updated dependencies [05a589a]
  - @askdb/studio@0.2.0-beta.21
  - @askdb/config@1.0.0-beta.7
  - @askdb/tui@0.2.0-beta.13

## 1.0.0-beta.23

### Patch Changes

- Updated dependencies [e4716c2]
- Updated dependencies [3ca848a]
  - @askdb/studio@0.2.0-beta.20

## 1.0.0-beta.22

### Patch Changes

- Updated dependencies [330e1d2]
- Updated dependencies [e3616e5]
- Updated dependencies [93a4c26]
  - @askdb/studio@0.2.0-beta.19

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/studio@0.2.0-beta.18
  - @askdb/introspect@0.3.0-beta.11
  - @askdb/mysql@0.1.0-beta.10
  - @askdb/postgres@0.2.0-beta.11
  - @askdb/sqlite@0.1.0-beta.10
  - @askdb/sqlserver@0.1.0-beta.10
  - @askdb/tui@0.2.0-beta.12
  - @askdb/connectors@0.1.0-beta.2
  - @askdb/prisma@0.2.0-beta.11

## 1.0.0-beta.20

### Patch Changes

- efe4a1b: **Ship `@askdb/connectors` — connector provider registry for app/bootstrap wiring.**

  Introduces `@askdb/connectors`, a new workspace package that mirrors the `@askdb/ai` registry pattern for introspection connectors. It provides a provider adapter abstraction and registry factory that concrete database packages register into, replacing per-app switch statements over engine names.

  **`@askdb/connectors`** exports:
  - `createAskDbConnectorRegistry(adapters)` — factory that accepts an array or object-map of provider adapters and returns a registry with `hasProvider()` and `createConnector(config)`.
  - `AskDbConnectorConfig` — unified config shape (`provider`, `url`, `fromExport`, `schemaPath`, `filters`, `schemaId`).
  - `AskDbConnectorResult` — `{ connector, input, mode }` pair consumed by `introspect()`.
  - `AskDbConnectorProviderAdapter` — interface each concrete package implements.
  - `ASKDB_CONNECTOR_PROVIDERS` and `AskDbConnectorProvider` type.
  - `askDbConnectorProviderMissingMessage()` helper for actionable error messages.

  **New provider adapter exports** from each concrete package:
  - `@askdb/postgres` → `postgresConnectorProvider` (live + from-export modes)
  - `@askdb/mysql` → `mysqlConnectorProvider`
  - `@askdb/sqlite` → `sqliteConnectorProvider`
  - `@askdb/sqlserver` → `sqlServerConnectorProvider`
  - `@askdb/prisma` → `prismaConnectorProvider`

  **CLI update:** `apps/cli` now wires all five connector providers through `createAskDbConnectorRegistry` instead of the inline switch in `buildRunConfig`. The CLI's URL resolution and validation logic is unchanged; only the connector/input construction path uses the registry.

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/connectors@0.1.0-beta.1
  - @askdb/postgres@0.2.0-beta.10
  - @askdb/mysql@0.1.0-beta.9
  - @askdb/sqlite@0.1.0-beta.9
  - @askdb/sqlserver@0.1.0-beta.9
  - @askdb/prisma@0.2.0-beta.10
  - @askdb/ai@0.1.0-beta.1
  - @askdb/ai-openai@0.1.0-beta.1
  - @askdb/ai-azure@0.1.0-beta.1
  - @askdb/ai-google@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20
  - @askdb/studio@0.2.0-beta.17
  - @askdb/tui@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.10

## 1.0.0-beta.19

### Major Changes

- 1eacf3f: Remove `database` config section; move connection URLs into `introspection` and `studio`.

  **Breaking:** `AskDbConfig.database` is removed. Move the Postgres connection URL from `database.providerConfig.postgres.databaseUrl` into `introspection.providerConfig.postgres.databaseUrl` (maps to `ASKDB_INTROSPECT_POSTGRES_URL`). The generic `DATABASE_URL` flat key is no longer set by `flattenAskDbConfig`.

  **Breaking:** Studio query execution (`POST /api/execute`) now reads `ASKDB_STUDIO_DATABASE_URL` instead of `DATABASE_URL`. Set `studio.execute.databaseUrl` in `askdb.config.*` (maps to `ASKDB_STUDIO_DATABASE_URL`).

  `AskDbRuntimeIntrospectionConfig` gains a new `postgresDatabaseUrl` field. The `DATABASE_URL` fallback for MySQL and SQL Server introspection is removed; configure those URLs explicitly via `introspection.providerConfig.<engine>.databaseUrl` or `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLSERVER_URL`.

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6
  - @askdb/studio@0.2.0-beta.16
  - @askdb/tui@0.2.0-beta.10

## 0.5.0-beta.18

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/studio@0.2.0-beta.15
  - @askdb/introspect@0.3.0-beta.9
  - @askdb/mysql@0.1.0-beta.8
  - @askdb/postgres@0.2.0-beta.9
  - @askdb/sqlite@0.1.0-beta.8
  - @askdb/sqlserver@0.1.0-beta.8
  - @askdb/tui@0.2.0-beta.9
  - @askdb/prisma@0.2.0-beta.9

## 0.5.0-beta.17

### Patch Changes

- Updated dependencies [49efa32]
- Updated dependencies [75a51f7]
  - @askdb/introspect@0.3.0-beta.8
  - @askdb/studio@0.2.0-beta.14
  - @askdb/mysql@0.1.0-beta.7
  - @askdb/postgres@0.2.0-beta.8
  - @askdb/prisma@0.2.0-beta.8
  - @askdb/sqlite@0.1.0-beta.7
  - @askdb/sqlserver@0.1.0-beta.7

## 0.5.0-beta.16

### Patch Changes

- Updated dependencies [36c35b4]
- Updated dependencies [b791213]
- Updated dependencies [f314b37]
- Updated dependencies [0d0040a]
  - @askdb/studio@0.2.0-beta.13
  - @askdb/core@0.5.0-beta.16
  - @askdb/introspect@0.3.0-beta.7
  - @askdb/mysql@0.1.0-beta.6
  - @askdb/postgres@0.2.0-beta.7
  - @askdb/sqlite@0.1.0-beta.6
  - @askdb/sqlserver@0.1.0-beta.6
  - @askdb/tui@0.2.0-beta.8
  - @askdb/prisma@0.2.0-beta.7

## 0.5.0-beta.15

### Patch Changes

- Updated dependencies [4d8d87f]
  - @askdb/studio@0.2.0-beta.12

## 0.5.0-beta.14

### Patch Changes

- Updated dependencies [c3c0f21]
- Updated dependencies [d220e9f]
- Updated dependencies [c7026a8]
  - @askdb/core@0.5.0-beta.14
  - @askdb/tui@0.2.0-beta.7
  - @askdb/studio@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.6
  - @askdb/mysql@0.1.0-beta.5
  - @askdb/postgres@0.2.0-beta.6
  - @askdb/sqlite@0.1.0-beta.5
  - @askdb/sqlserver@0.1.0-beta.5
  - @askdb/prisma@0.2.0-beta.6

## 0.5.0-beta.13

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5
  - @askdb/studio@0.2.0-beta.10
  - @askdb/tui@0.2.0-beta.6

## 0.5.0-beta.12

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12
  - @askdb/studio@0.2.0-beta.9
  - @askdb/tui@0.2.0-beta.5
  - @askdb/introspect@0.3.0-beta.5
  - @askdb/mysql@0.1.0-beta.4
  - @askdb/postgres@0.2.0-beta.5
  - @askdb/sqlite@0.1.0-beta.4
  - @askdb/sqlserver@0.1.0-beta.4
  - @askdb/prisma@0.2.0-beta.5

## 0.5.0-beta.11

### Patch Changes

- Updated dependencies [cd364e3]
- Updated dependencies [eff2f5d]
  - @askdb/postgres@0.2.0-beta.4
  - @askdb/introspect@0.3.0-beta.4
  - @askdb/studio@0.2.0-beta.8
  - @askdb/mysql@0.1.0-beta.3
  - @askdb/prisma@0.2.0-beta.4
  - @askdb/sqlite@0.1.0-beta.3
  - @askdb/sqlserver@0.1.0-beta.3

## 0.5.0-beta.10

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10
  - @askdb/studio@0.2.0-beta.7
  - @askdb/tui@0.2.0-beta.4
  - @askdb/introspect@0.3.0-beta.3
  - @askdb/mysql@0.1.0-beta.2
  - @askdb/postgres@0.2.0-beta.3
  - @askdb/sqlite@0.1.0-beta.2
  - @askdb/sqlserver@0.1.0-beta.2
  - @askdb/prisma@0.2.0-beta.3

## 0.5.0-beta.9

### Patch Changes

- Updated dependencies [0084012]
  - @askdb/studio@0.2.0-beta.6

## 0.5.0-beta.8

### Patch Changes

- @askdb/studio@0.2.0-beta.5

## 0.5.0-beta.7

### Patch Changes

- Updated dependencies [52cfa58]
  - @askdb/studio@0.2.0-beta.4

## 0.5.0-beta.6

### Patch Changes

- Updated dependencies [9c01a6d]
  - @askdb/tui@0.2.0-beta.3
  - @askdb/studio@0.2.0-beta.3

## 0.5.0-beta.5

### Patch Changes

- 1a3c63e: Align the `askdb init` generated `askdb.config.ts` template with the repo root config: canonical env names (`OPENAI_API_KEY`, `DATABASE_URL`, etc.), OpenAI RAG + file store defaults, and `logging`, `dev`, `tui`, `studio`, and `httpApi` sections.

## 0.5.0-beta.4

### Minor Changes

- 07dbc9a: **`askdb.config.ts` now configures MySQL / SQLite / SQL Server directly — no `--engine` flag required.**

  Adds three new discriminated-union branches to `AskDbIntrospectionConfig`, matching the existing postgres / prisma shape:

  ```ts
  introspection: {
    provider: "mysql",
    providerConfig: { mysql: { databaseUrl: env("DATABASE_URL") } },
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlite",
    providerConfig: { sqlite: { file: "./data/app.db" } },  // path, not URL
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlserver",
    providerConfig: { sqlserver: { databaseUrl: env("MSSQL_URL") } },
    outputDir: "./askdb/",
  }
  ```

  **Resolution ladder** per engine — first non-empty value wins:
  1. `introspection.providerConfig.<engine>.<field>` (structured)
  2. Provider-specific env key: `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLITE_FILE` / `ASKDB_INTROSPECT_SQLSERVER_URL`
  3. `DATABASE_URL` fallback — **for MySQL and SQL Server only**. SQLite has no `DATABASE_URL` fallback because file paths and URLs aren't interchangeable.

  **Runtime view.** `AskDbRuntimeIntrospectionConfig` gains resolved per-engine fields:

  ```ts
  introspection: {
    provider: AskDbIntrospectionProvider; // widened to all 5 ids
    prismaSchemaPath: string | undefined;
    mysqlDatabaseUrl: string | undefined;
    sqliteFile: string | undefined;
    sqlserverDatabaseUrl: string | undefined;
    outputDir: string | undefined;
  }
  ```

  **CLI.** `askdb introspect` now defaults `--engine` to `rt.introspection.provider` when the flag isn't passed, so `askdb introspect` works flag-free for every configured engine. Error messages name all three configuration paths (structured / env key / `DATABASE_URL`) so the precedence is discoverable.

  **The `database` block stays Postgres-only** — it's the RAG / pgvector home and isn't widened in this change. Non-Postgres introspection is self-contained inside its own `introspection` branch.

  **Compatibility.** Strictly additive. Existing configs continue to type-check and behave identically; the only widening user code sees is `AskDbRuntimeIntrospectionConfig.provider`, which goes from `"postgres" | "prisma"` to all five ids.

- 5ac67fc: **Ship `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` — direct introspection connectors for the non-Postgres relational engines.** Each package pairs with its `DialectSpec` in `@askdb/core` and exposes the same shape as `@askdb/postgres`: a `Connector` for `@askdb/introspect`, a live catalog query runner backed by the engine's standard driver, and the matching dialect re-export for convenience.
  - `@askdb/mysql` — introspects via `information_schema` (tables, columns, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mysql2`. Exports `createMysqlConnector`, `createMysqlCatalogQueryRunner`, `describeMysql`, `MYSQL_DIALECT`, `MARIADB_DIALECT`.
  - `@askdb/sqlite` — introspects via `sqlite_master` and the `pragma_*` table-valued functions (SQLite ≥ 3.16). Optional peer: `better-sqlite3`. Exports `createSqliteConnector`, `createSqliteCatalogQueryRunner`, `describeSqlite`, `SQLITE_DIALECT`.
  - `@askdb/sqlserver` — introspects via `sys.*` catalog views (schemas, tables, columns with precision/scale rendering, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mssql`. System schemas (`sys`, `INFORMATION_SCHEMA`, `db_*`, `guest`) are excluded by default. Exports `createSqlServerConnector`, `createSqlServerCatalogQueryRunner`, `describeSqlServer`, `SQLSERVER_DIALECT`.

  **CLI: `askdb introspect --engine mysql|sqlite|sqlserver`.** The CLI now wires the three new connectors behind `--engine`. Live mode only (no `--from-export` yet); `--url` carries the driver-native connection string for MySQL/SQL Server and the file path for SQLite. The shipped `provider` is persisted into `schema.json`, so `askdb ask` continues to auto-pick the matching dialect without further configuration.

  **Scope notes.** v1 surfaces tables, views, columns (with engine-correct type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes. Comments / default expressions / SQLite check constraints are not yet captured for these engines — follow-ups will close gaps as needed. From-export bundle mode and `askdb introspect templates` remain Postgres-only for now.

### Patch Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- 57db375: **Discriminated union types for `ai` and `introspection` in `AskDbConfig`** — each `provider` value now enforces exactly the right `providerConfig` branch at compile time (e.g. `provider: "openai"` requires `providerConfig: { openai: OpenaiConfig }` and rejects any other key). Named branch types are exported: `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `AskDbAiConfig`, `PostgresIntrospectionConfig`, `PrismaIntrospectionConfig`, `AskDbIntrospectionConfig`.

  **Prisma schema auto-discovery in `@askdb/prisma`** — `discoverPrismaSchemaPath()` is now exported and probes `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file) in order. Setting `introspection.provider: "prisma"` is now sufficient without an explicit `schemaPath`; the path can still be set via `introspection.providerConfig.prisma.schemaPath` to override discovery.

  **`ASKDB_PRISMA_SCHEMA` env var removed** — the Prisma schema path is read from the bootstrapped structured config (`getAskDbRuntimeConfig().introspection.prismaSchemaPath`) instead of a flat env key. `AskDbRuntimeConfig` gains a typed `introspection` field with `provider`, `prismaSchemaPath`, and `outputDir`.

  **`RUNTIME_SHELL_FLAT_OVERRIDES` removed from bootstrap** — `askdb.config.*` is now the sole source of truth; use `env("VAR")` inside the config file to read from shell or `.env` at load time.

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [5ac67fc]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/sqlite@0.1.0-beta.1
  - @askdb/core@0.5.0-beta.4
  - @askdb/postgres@0.2.0-beta.2
  - @askdb/introspect@0.3.0-beta.2
  - @askdb/prisma@0.2.0-beta.2
  - @askdb/mysql@0.1.0-beta.1
  - @askdb/sqlserver@0.1.0-beta.1
  - @askdb/studio@0.2.0-beta.2
  - @askdb/tui@0.2.0-beta.2

## 0.5.0-beta.3

### Patch Changes

- e604123: Running **`askdb introspect`** with no extra arguments now performs a Postgres introspection using **`DATABASE_URL`** and **`ASKDB_INTROSPECT_OUT`** from the bootstrapped `askdb.config` snapshot instead of printing usage. Use **`--help`** for the command reference.

## 0.5.0-beta.2

### Patch Changes

- cadd642: `askdb init` now installs **`@askdb/config`** and **`dotenv`** in the nearest non-workspace package (detects pnpm / npm / yarn / bun via lockfiles). Workspace roots get copy-paste install instructions instead. Add **`--skip-install`** to only write `askdb.config.ts`.

## 0.5.0-beta.1

### Minor Changes

- 06e5f54: **Breaking for npm consumers:** the CLI is published as the unscoped package **`askdb`** (was `@askdb/cli`). Update `package.json` dependencies and install commands accordingly (`npm i askdb`, `npx askdb init`, etc.). The `askdb` binary name is unchanged.

  Also updates a `@askdb/config` bootstrap doc comment that referenced the old package name, plus README cross-links in `@askdb/introspect` and `@askdb/tui`.

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1
  - @askdb/introspect@0.3.0-beta.1
  - @askdb/tui@0.2.0-beta.1
  - @askdb/studio@0.2.0-beta.1
  - @askdb/postgres@0.2.0-beta.1
  - @askdb/prisma@0.2.0-beta.1

## 0.5.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 48bfb62: Add `@askdb/studio`, a local browser UI for Schema v2 enrichment. Studio can browse tables and columns, edit describable metadata, save `tables/*.md`, request AI enrichment suggestions with the configured OpenAI-compatible key, and generate sample NL-to-SQL output against the saved schema enrichment.

  The main CLI now exposes `askdb studio --schema <dir>` as a shim for the Studio app. The shared TUI workspace save helper now creates `tables/` when needed so first-time describable files can be written from both UI surfaces.

- 289e63e: First public pre-1.0 release.

  `@askdb/core` ships the NL→SQL pipeline (`ask`), the BYO executor seam
  (`AskDbExecutor`, `TabularResult`), and the validated read-only PostgreSQL
  guardrail. `pg` is an **optional peer dependency** — consumers using a custom
  `executor` never need to install it. The built-in helpers live behind the
  `@askdb/core/postgres` subpath and lazy-load `pg` on first invocation, with a
  helpful error if the peer is missing.

  `askdb` (`askdb` binary) and `@askdb/http-api` (`askdb-http` binary,
  `POST /ask`) are thin wrappers over `@askdb/core` and ship together at the
  same version.

  This is the first version published to npm; semver applies to
  `packages/*/src/index.ts` exports and `docs/contracts/` going forward.

- a90543b: Reshape AskDB around one package per integration surface (Phase 7.5).

  **Pre-1.0 breaking — `@askdb/core`**
  - `ask()` now requires a `dialect: AskDialect` adapter. Pass `postgresDialect` from `@askdb/postgres` to keep the previous behavior.
  - The `connectionString`, `execute`, and `executor` options are removed from `ask()`. AskDB now returns generated SQL only.
  - The `@askdb/core/postgres` subpath is removed. Postgres-specific dialect, validation, generation, and introspection helpers move to `@askdb/postgres`.
  - The dialect-specific helpers `validatePostgresSelectSql`, `generatePostgresSelectSql`, `buildPostgresSelectGuardrailExplanation`, `buildNlToSqlUserPrompt`, `nlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` move to `@askdb/postgres`.
  - `AnyNormalizedSchema` is now exported from `@askdb/core` (it previously came in via the prompt module).
  - `pg` is no longer a peer dependency of `@askdb/core`.

  **Pre-1.0 breaking — `@askdb/introspect`**
  - The public `IntrospectionInput` discriminated union is removed. Each integration package owns its own input shape (e.g. `PostgresIntrospectionInput` from `@askdb/postgres`).
  - The `Connector` interface is now `Connector<TInput>`, generic over the integration's input. `templates()` is optional. The `engine: "postgres"` literal is gone.
  - `SqlTemplateName` and the Postgres-specific template name union are removed from the public surface. `SqlTemplate.name` is now `string`; `SqlTemplateBundle.engine` is now `string`.
  - `introspect()` no longer has a default connector. Callers must supply one via `options.connector` (e.g. `createPostgresConnector()`).
  - The `askdb-introspect` standalone binary and the `@askdb/introspect/cli` and `@askdb/introspect/postgres` subpaths are removed. Use `askdb introspect` from `askdb`, and import the connector from `@askdb/postgres`.

  **New — `@askdb/postgres`**
  - New package bundling the Postgres dialect (`postgresDialect`, `generatePostgresSelectSql`, `validatePostgresSelectSql`), the connector (`createPostgresConnector`, live + from-export), the catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`), the bundle reader, and the `pg`-backed catalog runner (`createPostgresCatalogQueryRunner`).
  - `pg` is an optional peer dependency, lazy-loaded only when live catalog introspection is invoked.

  **Pre-1.0 breaking — apps**
  - `askdb` now wires `postgresDialect` internally. The `askdb introspect` subcommand replaces the retired `askdb-introspect` binary.
  - `@askdb/http-api` no longer accepts execution controls or `connectionString` in request bodies. It returns generated SQL only.
  - `apps/{cli,http-api,tui,docs-site}` moved from `packages/*` to `apps/*`. Repository `directory` metadata updated accordingly.

- fdfd059: Add the Phase 7 `@askdb/tui` enrichment package and CLI shims.

  `@askdb/tui` provides the `askdb-tui` binary for editing Schema v2 table descriptions,
  aliases, column metadata, common query language, example questions, and concepts.
  It includes AI suggestion helpers with human confirm-before-save and a `bundle`
  command that emits loader-compatible single-file Schema v2 JSON artifacts.

  `@askdb/core` now exports enrichment-suggestion prompt helpers for BYO
  `LanguageModel` integrations. `askdb` adds `askdb enrich` and `askdb bundle`
  shims that delegate to `askdb-tui` when installed.

- d9d69bb: Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

  `askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

  Document Prisma as an integration package alongside Postgres.

- 4e462eb: Remove generated-SQL execution from AskDB package surfaces.
  - `@askdb/core` no longer exports `AskDbExecutor` / `TabularResult`, no longer accepts `execute` or `executor`, and `ask()` now returns generated SQL only.
  - `@askdb/introspect` now owns the introspection-only `CatalogQueryRunner` / `CatalogQueryResult` contract for connector catalog reads.
  - `@askdb/postgres` replaces `createPostgresExecutor` / `executeReadOnlySelect` with `createPostgresCatalogQueryRunner` for live introspection.
  - `askdb` and `@askdb/http-api` no longer execute generated SQL; old execution controls are rejected.

- cd23f50: **Breaking change (pre-1.0):** Schema v2 replaces the previous format. `loadSchema()` and `loadSchemaFromJson()` are the new entry points; the pre-v2 format is rejected with a clear error pointing at `docs/contracts/schema-v2.md`.

  New exports: `loadSchema`, `loadSchemaFromJson`, `parseTableMarkdown`, `parseConceptsMarkdown`, `writeTableMarkdown`, `writeConceptsMarkdown`, `formatSchemaV2ForNlToSql`, and all v2 types. `ask()` now accepts both `NormalizedSchema` (legacy) and `NormalizedSchemaV2`.

  CLI and HTTP API transparently pick up Schema v2 — pass a v2 directory path to `--schema` / `ASKDB_SCHEMA_PATH`.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- 25980e4: Centralize optional `askdb.config` defaults in `flattenAskDbConfig` instead of `optionalEnv`. `env()` now returns `undefined` when unset; add `requiredEnv` for fail-fast reads. Introduce `defaults.ts`, align the default RAG file-store path with `./askdb/rag`, and emit `ASKDB_PGVECTOR_INDEX_STRATEGY` when flattening pgvector. Refresh the `askdb init` template, root `askdb.config.ts`, and documentation.
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [48bfb62]
- Updated dependencies [25980e4]
- Updated dependencies [373e152]
- Updated dependencies [ec3ae3d]
- Updated dependencies [289e63e]
- Updated dependencies [28d1b68]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [d9d69bb]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
- Updated dependencies [6df0045]
- Updated dependencies [daa2625]
- Updated dependencies [767fcf2]
- Updated dependencies [373a9a7]
- Updated dependencies [6df0045]
  - @askdb/core@0.5.0-beta.0
  - @askdb/studio@0.2.0-beta.0
  - @askdb/tui@0.2.0-beta.0
  - @askdb/config@0.3.0-beta.0
  - @askdb/postgres@0.2.0-beta.0
  - @askdb/introspect@0.3.0-beta.0
  - @askdb/prisma@0.2.0-beta.0

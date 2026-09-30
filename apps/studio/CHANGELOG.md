# @askdb/studio

## 0.2.0-beta.36

### Minor Changes

- cc176d1: Breaking (pre-1.0, so a minor bump):

  - Require Node `>=22.12` consistently: `askdb`, `@askdb/http-api`, and `@askdb/studio` previously declared `>=22`, but the libraries they depend on already required `>=22.12`.
  - `@askdb/http-api` and `@askdb/studio` now declare an `exports` map: `.` (the package entry) and `./package.json`. Deep imports of other files, such as `@askdb/studio/dist/server.js`, are no longer allowed; import from the package entry instead.

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

### Patch Changes

- 1338535: **@askdb/core**: `ask()` now passes its dialect to `validateSensitiveReferences`, so the sensitive-column check lexes the returned SQL the way the target engine does instead of unioning every engine's reading. Custom `AskDialect`s (no `DialectSpec`) keep the conservative union. Tenant placeholder substitution (`resolveTenantSql`, `extractTenantPlaceholders`, `resolvePlaceholders`) also uses the dialect's lexer, so a `:tenant_*_ids` placeholder inside a MySQL backslash-escaped string literal or a MySQL `#` comment is left untouched, matching `bindPreparedQuery`. The case-variant placeholder check (`:TENANT_…` spellings are rejected) reads the same code regions with the same dialect, and no longer mistakes a `::type` cast for a placeholder.

  **@askdb/studio**: Playground execute's sensitive-column warnings lex the SQL with the execute engine's dialect.

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

- 1338535: **@askdb/core**: tenant parameter binding is dialect-correct and fails closed; `tenantFilters` is removed.

  - **Dialect-correct tenant markers.** In `tenantSqlMode: "sql-params"`, tenant IDs used to be bound with hardcoded Postgres `$N` markers. Since business parameters started using the dialect's markers, a MySQL, SQLite, or SQL Server statement could contain `?` or `@pN` markers next to `$2`. Tenant markers now follow the dialect: `$N` for Postgres, CockroachDB, and custom `AskDialect`s; `?` for MySQL, MariaDB, and SQLite; `@pN` for SQL Server.
  - **Executable pairs.** `sql` + `tenantParams` now runs on its own. Before, when parameterized extras were present, the tenant markers in `sql` were numbered after the business values (`$2`), but `tenantParams` held only the tenant IDs. `unboundSql` + `params` carries every value in marker order: tenant IDs come after the business values for `$N`/`@pN` dialects, or interleaved in source order for `?` dialects, and `parameters[].indices` are remapped to match. Never concatenate `params` and `tenantParams`.
  - **Only SQL code is substituted.** Before, a tenant placeholder inside a string literal was also replaced, and the escaped ID's quotes then closed the surrounding literal, which let a crafted tenant ID become SQL. Placeholder text inside string literals and quoted identifiers is now left untouched.
  - **Unresolved placeholders throw.** Before, a `:tenant_*` placeholder with no IDs in scope, or with no matching root, was silently left in the SQL. It now throws `TenantScopeError` with the new reason `UNRESOLVED_TENANT_PLACEHOLDER`.
  - **Operators are rewritten correctly.** Before, with several IDs, `!=`, `<=`, and `>=` were corrupted into `!IN (…)`, `<IN (…)`, and `>IN (…)`. Now `=` becomes `IN (…)`, `!=`/`<>` become `NOT IN (…)`, `= ANY(…)` becomes `IN (…)`, and `<> ALL(…)` becomes `NOT IN (…)`. `<`, `>`, `<=`, `>=`, or any other position with several IDs throws `TenantScopeError` with the new reason `UNSUPPORTED_TENANT_PREDICATE`.
  - **`resolveTenantSql()` rejects an unexpanded `subtree` scope.** It doesn't walk the hierarchy, so it used to substitute the seed `rootIds` only and silently drop every descendant. It now throws `TenantScopeError` with reason `SUBTREE_NOT_RESOLVABLE`. `ask()` is unaffected: it expands a `subtree` through `resolveTenantDescendants` before substitution. A direct caller passes a `multi_root` access with each tenant root's IDs under that root (an `ids` access only when the whole subtree is one root table), never descendant IDs under the root's placeholder.
  - **The tenant guardrail matches only SQL code.** A tenant column or table name that appears only inside a string literal (`'…'`, `$tag$…$tag$`) or a comment no longer counts as a predicate or a table reference. The placeholder branch of the scoped-table check, which could never match before, now works. Queries that previously passed only by accident can now produce warnings in `warn` mode or be rejected in `strict` mode. The guardrail is still a heuristic lint over identifier presence, not a SQL parser.
  - **The tenant guardrail reads SQL the way the target dialect does.** `validateTenantGuardrails()` takes a new optional 4th argument, `{ dialect }`, and `ask()` and `generateSelectSql()` pass their dialect. On MySQL and MariaDB, `status = "agency_id"` (a string there) and `'it\'s agency_id'` (one backslash-escaped string) used to pass as tenant predicates, and `ask()` returned the unscoped SQL with `passed: true`. They are now flagged, and `#` comments are ignored. Without a dialect (a custom `AskDialect`, or no `options.dialect`), the statement must pass under the standard-SQL, Postgres, and MySQL readings. So a predicate written only as `"agency_id"` is now flagged there; pass the dialect to accept it.
  - **The tenant guardrail reads Postgres `E'…'` strings.** On Postgres and CockroachDB, `note = E'it\'s agency_id'` used to pass as a tenant predicate because `\'` was read as the end of the string. A backslash now escapes the next character inside an `E'…'` string (only when the `E` starts a token, not for `date'…'`), and a statement without a dialect must also pass this Postgres reading.
  - **Inlined tenant IDs are escaped for a partial dialect.** `resolveTenantSql(…, "sql-only", 1, { id: "mysql" })` used to double quotes only, so a tenant ID containing `\'` could close its literal under MySQL's default backslash escaping. When `backslashEscapes` is unset, a built-in `id` now supplies it; with an unknown `id`, a tenant ID containing a backslash throws `TenantScopeError` with the new reason `UNESCAPABLE_TENANT_ID`. The `TenantSqlDialect` type is exported.
  - **Tenant placeholders are case-sensitive.** `:TENANT_AGENCY_IDS` was counted as a tenant predicate but never substituted, so `ask()` returned SQL with the raw placeholder and `passed: true`. The guardrail now counts only the exact lowercase form, and `resolveTenantSql()` (and so `ask()`) throws `TenantScopeError` with `UNRESOLVED_TENANT_PLACEHOLDER` for any other casing.
  - **Breaking (types): `TenantScope.tenantFilters`, `TenantFilter`, and `TenantFilterCondition` are removed.** No code ever read them, so setting them had no effect. TypeScript callers now get a compile error; at runtime a stray `tenantFilters` key is still ignored by validation. Polymorphic tables in the tenant policy are unaffected.

  **@askdb/studio**: the playground no longer offers the tenant-filter editor or the Subtree access kind. Studio can't supply the `resolveTenantDescendants` callback a `subtree` scope needs, so every subtree ask would fail closed. A saved history entry that uses subtree scope shows a validation message.

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 5dbe2d6: **MySQL/MariaDB: introspect several databases at once.**

  **@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

  **@askdb/config**: New `introspection.schemas?: string[]`, the config equivalent of `askdb introspect --schemas`, for every provider (on MySQL/MariaDB, the databases to introspect). Runtime config exposes it as `introspection.schemas`.

  **askdb**: `askdb introspect` reads `introspection.schemas` from config for any engine; `--schemas` overrides it.

  **@askdb/studio**: Resync passes the configured schema list to the connector, so it matches `askdb introspect`.

- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- 8410840: **Fix a cross-tenant leak in `subtree` scopes (#338): `resolveTenantDescendants` now returns IDs per tenant root.** The resolver returned one flat list, and `ask()` bound every ID to the scope root's placeholder. In a multi-table hierarchy (agencies → sub-agencies → clients), a sub-agency or client ID that equalled another agency's ID matched that agency's rows. The resolver now returns `TenantIdsByRoot` (`Record<rootTableId, string[]>`), and `ask()` expands the subtree into a `multi_root` scope, so each root's IDs bind only to that root's own placeholder. A resolver that still returns an array throws `TenantScopeError` (`SUBTREE_NOT_RESOLVABLE`) with a message showing the per-root shape to return. So does a key that isn't a tenant root in the subtree. Migrate a same-table resolver by returning `{ [tenantRoot]: ids }`. The decision and the options are in `docs/adrs/0014-subtree-scope-expands-per-root.md`.

  The resolver's result is read once: each entry is snapshotted before validation, and the scope is built from that snapshot. A getter can't return different IDs to validation and binding, and a non-enumerable property is never read.

  **A policy whose roots derive the same placeholder is now rejected.** `Agency` and `agency` both give `:tenant_agency_ids`, as do `Sub-Agency` and `Sub Agency` with `:tenant_sub_agency_ids`. Substitution then bound one root's IDs where the other root's column is compared. Loading such a policy throws `SchemaParseError` naming both roots. `validateTenantScope()` (and so `ask()`) and `resolveTenantSql()` also throw it for a policy built in code. This applies to every scope kind.

  **Labels without ASCII letters or digits now get a usable placeholder.** The placeholder keeps only ASCII letters and digits from the label, so every root labelled in Cyrillic, CJK or another non-Latin script derived `:tenant___ids`, and a policy with two such roots could never bind the right IDs. For such a label, the placeholder now comes from the root's table name (`Клиент` on `table:public.clients` → `:tenant_clients_ids`). Labels with an ASCII letter or digit keep their placeholder. Two setups that work today change, and both fail closed with an error:
  - A lone root labelled without ASCII letters or digits gets a new placeholder name. SQL or code that still uses `:tenant___ids` (stored SQL, SQL passed to `resolveTenantSql()`, or a lookup by `tenantBindings[].placeholder` or a prepared-query parameter name) throws `UNRESOLVED_TENANT_PLACEHOLDER`.
  - A non-ASCII label whose table name matches another root's label (`Агентство` on `table:public.agency` next to a root labelled `agency`) now fails at load with `SchemaParseError`.

  To migrate, switch to the new name (`placeholderForTenantRoot(root)` returns it; see "Tenant types" in the core API reference), or give the root an ASCII label. For a load failure, rename one of the two labels.

  **New export `placeholderForTenantRoot(root)`**, which takes the root object and returns the placeholder core prompts for and binds. `placeholderForRoot(label)` keeps its signature and its output, and is now `@deprecated`: for a label with no ASCII letter or digit it still returns `:tenant___ids`, which core no longer binds.

  **The tenant prompt now pairs each placeholder with its columns when the policy has more than one root.** Under each `:tenant_<label>_ids` line of a `multi_root` or `ids` scope, it lists the columns that hold that root's IDs (its own ID column, child roots' foreign keys to it, scoped tables' direct columns, and polymorphic ID columns with their discriminator value). It then tells the model never to compare one root's placeholder with another root's column. This changes the prompt bytes for every `multi_root` scope, and for `ids` scopes on multi-root policies. A single-root policy's `ids` prompt is unchanged. For `multi_root`, the prompt leaves a child root's foreign key out of its parent's list when that child is in the scope, marks a root with no IDs, and says that every listed root table the query reads must be filtered with its own placeholder. An expanded subtree is a `multi_root` scope, so the strict tenant guardrail from #315's fix checks it like any other: each tenant column must be compared with its own root's placeholder, and every root the expanded scope covers is checked as a root table. A query that reads a covered child root (`clients`) and filters it only through its parent's foreign key (`clients.sub_agency_id`) or a joined ancestor is rejected.

  **A covered level with no IDs stays in the expanded scope.** When the resolver returns no IDs for a level, that root stays in the `multi_root` scope with an empty ID list, instead of being dropped. Reading it then needs its own placeholder, which binds nothing and throws `UNRESOLVED_TENANT_PLACEHOLDER`. Dropped, it was checked less strictly than a level with IDs. A `multi_root` entry may now have an empty `ids` list (the scope schema and `validateTenantScope()` accept it, and at least one entry must still have an ID), so a custom `AskDialect` that validates its scope accepts the expansion, and a host expanding by hand can express an empty level. Reads through a parent's key or an ancestor are rejected under `enforcement: strict`; under `warn` they come back with a warning.

  **`buildTenantPromptBlock()` rejects an unexpanded `subtree` scope** with `SUBTREE_NOT_RESOLVABLE`, like `resolveTenantSql()`, instead of rendering only the root's placeholder.

  **@askdb/studio**: saving a tenant policy now runs the same validation as loading it. A policy the schema loader would reject, such as two roots deriving one placeholder, returns 400 with the loader's message, and nothing is written. Before, Studio wrote the file, returned 500, and then failed every request until the file was fixed by hand. The playground's message for a saved `subtree` scope now says to use the Multi-root scope with each root's IDs in its own row, not to fold the subtree into the IDs scope.

  **@askdb/docs-site**: the multi-tenancy guide, the `ask()` and client references, troubleshooting, and `/AGENTS.md` document the per-root resolver with an agency → sub-agency → client example. The core API reference documents `placeholderForTenantRoot(root)` and the deprecation of `placeholderForRoot(label)`.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [5dbe2d6]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/enrich@0.2.0-beta.14
  - @askdb/ai-anthropic@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.7
  - @askdb/ai-google@1.0.0-beta.7
  - @askdb/ai-openai@1.0.0-beta.7
  - @askdb/ai@0.1.0-beta.7
  - @askdb/config@1.0.0-beta.12
  - @askdb/connectors@0.1.0-beta.8
  - @askdb/introspect@0.3.0-beta.17
  - @askdb/mysql@0.1.0-beta.18
  - @askdb/postgres@0.2.0-beta.19
  - @askdb/prisma@0.2.0-beta.17
  - @askdb/rag@0.2.0-beta.23
  - @askdb/sqlite@0.1.0-beta.18
  - @askdb/sqlserver@0.1.0-beta.19

## 0.2.0-beta.35

### Patch Changes

- 5781271: Fix several bugs in the Studio web app that were hidden because `tsconfig.web.json` inherited an `exclude` from the root config that silently disabled type-checking for `src/web`:

  - Concepts page "Revert" button was calling state setters left over from a pre-`useReducer` refactor and did nothing.
  - Removing a tenant policy hierarchy edge removed the wrong row (missing loop index).
  - Total token count in the request usage summary could throw on a `null` total; it's now hidden like the other usage rows when unavailable.
  - The playground's saved-history `explain` field could be assigned a non-string value.
  - Removed the schema table's "Default" column, which never had backing data.

  Internal: swapped `eslint-plugin-import` for `eslint-plugin-import-x`, since the former doesn't support ESLint 10.

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/ai@0.1.0-beta.6
  - @askdb/ai-anthropic@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.6
  - @askdb/ai-google@1.0.0-beta.6
  - @askdb/ai-openai@1.0.0-beta.6
  - @askdb/config@1.0.0-beta.11
  - @askdb/connectors@0.1.0-beta.7
  - @askdb/enrich@0.2.0-beta.13
  - @askdb/introspect@0.3.0-beta.16
  - @askdb/mysql@0.1.0-beta.17
  - @askdb/postgres@0.2.0-beta.18
  - @askdb/prisma@0.2.0-beta.16
  - @askdb/rag@0.2.0-beta.22
  - @askdb/sqlite@0.1.0-beta.17
  - @askdb/sqlserver@0.1.0-beta.18

## 0.2.0-beta.34

### Minor Changes

- 0c44b76: Add provider-portable reasoning/latency effort controls for AskDB model calls.

  Set `reasoningEffort: "minimal" | "low" | "medium" | "high"` via `@askdb/ai`'s
  `resolveProviderOptions(config, { reasoningEffort })` and each `@askdb/ai-*`
  adapter maps it to the provider's native knob — OpenAI/Azure
  `providerOptions.openai.reasoningEffort`, Google Gemini 3.x
  `thinkingConfig.thinkingLevel`, Gemini 2.5 `thinkingConfig.thinkingBudget`,
  Anthropic extended `thinking`. Adapters skip models that don't support
  reasoning tuning, so unsupported providerOptions are never sent.

  `@askdb/core`'s `ask()`, `generateSelectSql()`, and `suggestEnrichment()` gain
  an opaque `providerOptions` passthrough forwarded verbatim to `generateText`
  — core stays BYO-model and does not interpret it. Unset, behavior is
  unchanged.

  `askdb.config.*` gains an `ai.reasoning` block (`effort`, `nlToSql`,
  `enrichment`) for per-call-site defaults, flattened to
  `ASKDB_AI_REASONING_EFFORT[_NL_TO_SQL|_ENRICHMENT]` env vars.

  `@askdb/client`'s `createAskDb`/`ask()` now resolve `ai.reasoning` and apply
  it automatically — no manual wiring required for the common client/CLI/HTTP
  API path. `CreateAskDbOptions.reasoningEffort` sets a client-level default;
  `AskOverrides.reasoningEffort` overrides it per call. Studio's sample-question
  and enrichment-suggestion endpoints resolve and forward reasoning effort the
  same way.

  Azure/Foundry deployments are identified by an arbitrary deployment name that
  may not match the underlying model id, so reasoning-model detection can't
  always rely on `model` alone. Set `providerConfig.azure.modelFamily` (or
  `ASKDB_AI_AZURE_MODEL_FAMILY`) to the real model id (e.g. `"gpt-5"`) to
  declare it explicitly when the deployment name doesn't already look like one.

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
  - @askdb/rag@0.2.0-beta.21
  - @askdb/enrich@0.2.0-beta.12
  - @askdb/introspect@0.3.0-beta.15
  - @askdb/mysql@0.1.0-beta.16
  - @askdb/postgres@0.2.0-beta.17
  - @askdb/sqlite@0.1.0-beta.16
  - @askdb/sqlserver@0.1.0-beta.17
  - @askdb/connectors@0.1.0-beta.6
  - @askdb/prisma@0.2.0-beta.15

## 0.2.0-beta.33

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/enrich@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.14
  - @askdb/mysql@0.1.0-beta.15
  - @askdb/postgres@0.2.0-beta.16
  - @askdb/rag@0.2.0-beta.20
  - @askdb/sqlite@0.1.0-beta.15
  - @askdb/sqlserver@0.1.0-beta.16
  - @askdb/connectors@0.1.0-beta.5
  - @askdb/prisma@0.2.0-beta.14

## 0.2.0-beta.32

### Patch Changes

- 84069cf: Drop dotenv from generated config; use DATABASE_URL universally; generate .env.example with placeholder connection strings.

  `askdb init` and the Studio setup wizard no longer emit `import dotenv` or install `dotenv` explicitly — `bootstrapAskDbEnv()` already loads `.env` before evaluating the config file, and `dotenv` is already a transitive dependency of `@askdb/config`.

  All network database providers (postgres, mysql, sqlserver) now default to `DATABASE_URL` instead of provider-specific names like `MYSQL_URL` or `SQLSERVER_URL`.

  Both `askdb init` and the Studio wizard now generate a `.env.example` alongside `askdb.config.ts`, pre-populated with a ready-to-copy placeholder connection string in the correct format for the selected database (postgresql:// URI, mysql:// URI, or MSSQL ADO.NET connection string).

## 0.2.0-beta.31

### Minor Changes

- 5acd920: **@askdb/studio**: the guided setup wizard reaches parity with `askdb init` — it now also asks for the AI model env var, RAG store (file/memory/pgvector), Studio execute config, and supports the Azure AI Foundry provider. Env var _name_ fields (connection URL, AI key, AI model, pgvector, Studio execute connection) render as a pre-filled default and only become editable when clicked, instead of always showing an open text input. Fixes a bug where writing a config with `ragStore: "pgvector"` before `.env` was filled in returned a 500.

  **askdb**: `askdb init`'s interactive wizard no longer prompts you to name env vars — it uses conventional defaults (`DATABASE_URL`, `OPENAI_API_KEY`, ...) and tells you in the summary/next-steps output that you can rename any `env("...")` call in the generated `askdb.config.ts` afterward.

## 0.2.0-beta.30

### Patch Changes

- 7311ac5: **@askdb/client**: `createAskDb()` accepts a new `providers` option — pass the adapter(s) for your configured provider and the client builds the AI registry internally:

  ```ts
  import { createAskDb } from "@askdb/client";
  import { openaiProvider } from "@askdb/ai-openai";

  const askdb = createAskDb({
    config: getAskDbRuntimeConfig(),
    providers: [openaiProvider], // no more createAiRegistry boilerplate
  });
  ```

  You no longer import anything from `@askdb/ai` on the config-driven path — it is now a regular dependency of `@askdb/client` (previously a peer), so install commands drop it too. The existing `registry` option remains supported as the advanced alternative (e.g. sharing one registry across several clients); passing both, or neither, throws with a clear message. Non-breaking for existing `registry` callers.

  **@askdb/studio**: the Playground "Get the code" panel emits the new `providers` style in its config-driven snippet.

- fa690a3: Fix the Query Playground's Token Usage panel, which never rendered: `ai@6`'s `generateText` usage object reports `inputTokens`/`outputTokens` rather than the legacy `promptTokens`/`completionTokens` fields, so the studio server's usage collector always produced `null`. The panel also now renders below the query results section instead of above it.
- b7f70b6: **@askdb/studio**: The Overview page's "Resync schema" status message now shows a loading/check/error icon (previously plain colored text via `InlineStatus`, unlike `StatusBanner`'s matching icon set) and clears itself 4s after success, matching the existing auto-clear behavior for table save and RAG build statuses.
- 56920c8: Clean up the Query Playground's Explain section: it's now collapsed by default (was always expanded, pushing "Get the code" and "Execute Query" down the page), and the guardrail check output renders as a statement-kind chip plus a checkmark list instead of a raw JSON dump. Unrecognized explain shapes still fall back to the raw JSON view.
- 7311ac5: Surface token usage through the full AskDB stack and add comprehensive API reference documentation.

  **@askdb/core** — new `AskUsage` type (`promptTokens`, `completionTokens`, `totalTokens`); `generateSelectSql` now captures token usage from the `generateText` result; `AskDialectGenerateResult` and `AskPipelineResult` both include `usage?: AskUsage`; exported from the package index.

  **@askdb/http-api** — `POST /ask` success response now includes `usage: AskUsage | null`.

  **@askdb/studio** — Token usage re-added to the Query Playground (was dropped in the IA redesign migration); `UsageSummary` extracted to a shared component used by both the Playground and RAG Index page; display now correctly shows Prompt, Completion, and Embeddings rows individually.

- Updated dependencies [162c33b]
- Updated dependencies [7311ac5]
  - @askdb/ai@0.1.0-beta.4
  - @askdb/ai-openai@1.0.0-beta.4
  - @askdb/ai-anthropic@1.0.0-beta.2
  - @askdb/ai-google@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.4
  - @askdb/core@1.0.0-beta.36
  - @askdb/enrich@0.2.0-beta.10
  - @askdb/introspect@0.3.0-beta.13
  - @askdb/mysql@0.1.0-beta.14
  - @askdb/postgres@0.2.0-beta.15
  - @askdb/rag@0.2.0-beta.19
  - @askdb/sqlite@0.1.0-beta.14
  - @askdb/sqlserver@0.1.0-beta.15
  - @askdb/connectors@0.1.0-beta.4
  - @askdb/prisma@0.2.0-beta.13

## 0.2.0-beta.29

### Minor Changes

- 45fef02: **@askdb/studio**: Studio is now a viable front door for a brand-new project.

  - **Guided setup wizard.** `askdb studio` (or `askdb-studio`) in a directory with no `askdb.config.*` or no schema artifact no longer errors out — Studio starts in setup mode and the browser walks you through it: pick a database engine and AI provider (env var _names_ only — secret values stay in `.env`, which the wizard tells you to create), Studio writes `askdb.config.ts` and `.env.example`, then runs introspection server-side and opens the Overview. New endpoints: `GET /api/setup/status`, `POST /api/setup/config`, `POST /api/setup/introspect` (config write and introspection are loopback-only). Passing an explicit `--schema` that doesn't exist still fails fast.
  - **"Resync schema" now works.** The Overview button (previously a no-op) re-runs introspection server-side using the connection from `askdb.config.ts` — same engine resolution as `askdb introspect` with no flags — and reloads the workspace. Enrichment markdown is preserved, exactly like the CLI path. New endpoints: `GET /api/introspect/status` (plan preview with credential-redacted source), `POST /api/introspect` (loopback-only).
  - **"Get the code" panel in the Playground.** Below the generated SQL, Studio renders the exact integration snippet for the current workspace — your question, schema path, resolved dialect, configured provider, and (when enabled) the tenant scope — in two styles: config-driven `createAskDb()` from `@askdb/client`, or direct `ask()` from `@askdb/core`. Copy-paste it into a Node service and it runs against the same config Studio uses.
  - `StudioWorkspaceDto` gains `dialect` and `schemaPathRelative`.

  **askdb**: `askdb studio` no longer aborts when no `askdb.config.*` exists — it starts Studio in setup mode so the browser wizard can scaffold the project. All other commands still require a config.

## 0.2.0-beta.28

### Patch Changes

- a30643a: Fix Query Playground split-view layout across screen sizes.

  The two-column split (question left, results right) now fills the full available height and each pane scrolls independently. Previously the outer `main-body` padding broke the edge-to-edge divider and `minHeight: 100%` failed to stretch the grid to fill the pane.

## 0.2.0-beta.27

### Patch Changes

- 5affd84: **@askdb/{postgres,mysql,sqlite,sqlserver}**: Driver loaders (`createXxxCatalogQueryRunner`) now accept a `resolveFrom?: string` option for embedders that need to resolve the optional native peer from a directory other than `process.cwd()` (e.g. `@askdb/studio` running from an npx cache while the user project sits elsewhere). New `loadXxxDriver` and `isXxxDriverInstalled` helpers are exported for the same reason. `@askdb/sqlserver` additionally re-exports `resolveConnectionInput` and the `MssqlConfigInput` type so embedders can apply the same connection-string normalization the catalog runner uses. Behavior with no option / no helper import is unchanged.

  **@askdb/studio**: SQL Server query execution now routes the connection string through `@askdb/sqlserver`'s `resolveConnectionInput` before constructing the `mssql.ConnectionPool`. Fixes `Failed to connect to localhost:1433 - self-signed certificate` failures on ADO.NET connection strings that use the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default), and adds support for `mssql://` and Prisma-style `sqlserver://` URLs — matching the introspect path. Internal: the execute registry now delegates driver loading and per-engine connection-string normalization to the `@askdb/<engine>` packages instead of re-implementing them, eliminating the drift surface that caused the TLS regression in the first place.

- Updated dependencies [5affd84]
  - @askdb/postgres@0.2.0-beta.14
  - @askdb/mysql@0.1.0-beta.13
  - @askdb/sqlite@0.1.0-beta.13
  - @askdb/sqlserver@0.1.0-beta.14

## 0.2.0-beta.26

### Patch Changes

- 9689c3a: Fix Studio driver detection when running via `npx askdb studio`.

  Bare `import("mssql")` (or any other driver) resolves relative to the Studio binary in the npx cache, not the user's project, so drivers already installed in the project were always reported as missing. Replaced with `createRequire`-based resolution from the user's project root so that installed-check, execute, and post-install refresh all correctly reflect the project's own `node_modules`.

## 0.2.0-beta.25

### Minor Changes

- dc380bc: Add multi-dialect execute support to Studio Query Playground and expose driver-readiness status.

  **`@askdb/config`** — `studio.execute` gains a `provider` field (`"postgres" | "mysql" | "sqlite" | "sqlserver"`) and a `file` field for SQLite. The runtime config resolves the execute provider from: explicit `studio.execute.provider` → active introspection provider (when it is a live engine) → `"postgres"` (backward-compatible default). Connection resolution per provider: Postgres and MySQL and SQL Server use `databaseUrl` (falling back to their introspection URL); SQLite uses `file` (falling back to the introspection file). New canonical env keys: `ASKDB_STUDIO_EXECUTE_PROVIDER` and `ASKDB_STUDIO_SQLITE_FILE`. `ASKDB_STUDIO_DATABASE_URL` is preserved for backward compatibility. New constants: `ASKDB_STUDIO_EXECUTE_PROVIDERS`, `AskDbStudioExecuteProvider`.

  **`@askdb/studio`** — Studio can now execute SQL against Postgres, MySQL, SQLite, and SQL Server from the Query Playground. Each driver (`pg`, `mysql2`, `better-sqlite3`, `mssql`) is an optional peer dependency and is dynamically imported only when needed. New endpoints: `GET /api/execute/status` (returns the configured provider, driver package name, installed status, and install command without ever throwing for a missing driver) and `POST /api/execute/install-driver` (loopback-only; detects the project package manager from the nearest lockfile; installs only the allowlisted package for the configured provider). The Execute button in the Playground shows a compact status row with the provider label, connection/file status, driver readiness, an Install button when the driver is missing (local Studio only), or a manual install command. All four driver packages are added as dev dependencies for local development and CI type-checking; only the driver for the configured dialect needs to be installed by the application at runtime.

### Patch Changes

- dc380bc: Remove direct `pg` runtime dependencies from bundled app surfaces and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.
- Updated dependencies [dc380bc]
- Updated dependencies [dc380bc]
  - @askdb/postgres@0.2.0-beta.13
  - @askdb/config@1.0.0-beta.9
  - @askdb/rag@0.2.0-beta.18

## 0.2.0-beta.24

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

- Updated dependencies [d4a0a1d]
- Updated dependencies [4dd7a59]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
- Updated dependencies [96e6963]
  - @askdb/ai-anthropic@1.0.0-beta.1
  - @askdb/ai@0.1.0-beta.3
  - @askdb/config@1.0.0-beta.8
  - @askdb/ai-openai@1.0.0-beta.3
  - @askdb/ai-azure@1.0.0-beta.3
  - @askdb/ai-google@1.0.0-beta.3
  - @askdb/rag@0.2.0-beta.17

## 0.2.0-beta.23

### Patch Changes

- baf5ad8: Restore AI SDK 6 embedding compatibility and preserve RAG embedding options.
- baf5ad8: Refresh dependency ranges across the workspace.
- 999ba36: Fix RAG index badge not updating automatically after saving table enrichment, concepts, or tenant policy. The stale/fresh indicator on the nav bar and RAG page now refreshes immediately after any save without requiring a manual refresh click.
- baf5ad8: Declare the PostgreSQL driver required by Studio query execution.
- Updated dependencies [baf5ad8]
- Updated dependencies [baf5ad8]
  - @askdb/ai@0.1.0-beta.2
  - @askdb/ai-openai@0.1.0-beta.2
  - @askdb/ai-azure@0.1.0-beta.2
  - @askdb/rag@0.2.0-beta.16
  - @askdb/ai-google@0.1.0-beta.2
  - @askdb/core@1.0.0-beta.26
  - @askdb/postgres@0.2.0-beta.12
  - @askdb/enrich@0.2.0-beta.9

## 0.2.0-beta.22

### Patch Changes

- 8371033: Fix stale query results persisting when a new natural language query is submitted in the Playground.

  Previously, `executeResult` was not cleared when a new question was asked, so the previous results table remained visible until the user manually clicked "Execute Query" again. Submitting a new question now atomically clears both the generated SQL and the execution results.

  Refactored `playground-context` and `rag-context` to use named compound reducer actions (`start_ask`, `ask_succeeded`, `execute_completed`, `rag_build_completed`, `rag_query_completed`) instead of multiple sequential dispatches, so each logical state transition is atomic and clearly named.

## 0.2.0-beta.21

### Patch Changes

- 05a589a: Fix Studio execute endpoint not reading `databaseUrl` from `askdb.config.*`.

  `POST /api/execute` was reading `ASKDB_STUDIO_DATABASE_URL` directly from `process.env`, which is never populated because `bootstrapAskDbEnv` intentionally does not mutate `process.env`. The studio now reads `studio.execute.databaseUrl` via `getAskDbRuntimeConfig()`.

  `@askdb/config` gains `AskDbRuntimeStudioConfig` (exported) and a `studio` field on `AskDbRuntimeConfig`, making the studio database URL available through the typed runtime config accessor.

- Updated dependencies [05a589a]
  - @askdb/config@1.0.0-beta.7
  - @askdb/rag@0.2.0-beta.15

## 0.2.0-beta.20

### Patch Changes

- e4716c2: Fix warning badge illegibility in dark mode by adding `dark:` variant classes to the Badge CVA definition, following the same pattern used by Button.
- 3ca848a: Refactor studio UI components: split monolithic `ui.tsx` into individual files under `ui/`, migrate `Badge` to `cva`-based variants, update all import sites to point directly to individual component files, and remove the unused `@radix-ui/react-slot` dependency.

## 0.2.0-beta.19

### Patch Changes

- 330e1d2: Fix all 40 React Doctor issues (58→100/100): hoist Intl formatters, flatMap/reduce chained iterations, useReducer for 5 large state groups, useRef for non-rendered state, lazy useState initializer for mount state, stabilise useMemo deps, aria-label on unlabelled controls, bump tiny text to 12 px, extract large inline styles to CSS classes, move pure functions to module scope, and use semantic fieldset/ARIA patterns.
- e3616e5: Prevent Studio startup and route sync effects from re-running indefinitely after context provider state updates, and clear the remaining React Doctor warnings in Studio.
- 93a4c26: Add guided tenant scope controls in Studio with a generated `tenantScope` JSON preview.

## 0.2.0-beta.18

### Patch Changes

- dda0abf: Allow saved tenant policies to be reopened and edited in Studio.
- dda0abf: Keep AI enrichment suggestions available after using one candidate.
- dda0abf: Show untracked tables as a sidebar filter badge alongside enrichment status badges.
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/rag@0.2.0-beta.14
  - @askdb/enrich@0.2.0-beta.8
  - @askdb/postgres@0.2.0-beta.11

## 0.2.0-beta.17

### Patch Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/postgres@0.2.0-beta.10
  - @askdb/ai@0.1.0-beta.1
  - @askdb/ai-openai@0.1.0-beta.1
  - @askdb/ai-azure@0.1.0-beta.1
  - @askdb/ai-google@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20
  - @askdb/enrich@0.2.0-beta.7
  - @askdb/rag@0.2.0-beta.13

## 0.2.0-beta.16

### Minor Changes

- 1eacf3f: Remove `database` config section; move connection URLs into `introspection` and `studio`.

  **Breaking:** `AskDbConfig.database` is removed. Move the Postgres connection URL from `database.providerConfig.postgres.databaseUrl` into `introspection.providerConfig.postgres.databaseUrl` (maps to `ASKDB_INTROSPECT_POSTGRES_URL`). The generic `DATABASE_URL` flat key is no longer set by `flattenAskDbConfig`.

  **Breaking:** Studio query execution (`POST /api/execute`) now reads `ASKDB_STUDIO_DATABASE_URL` instead of `DATABASE_URL`. Set `studio.execute.databaseUrl` in `askdb.config.*` (maps to `ASKDB_STUDIO_DATABASE_URL`).

  `AskDbRuntimeIntrospectionConfig` gains a new `postgresDatabaseUrl` field. The `DATABASE_URL` fallback for MySQL and SQL Server introspection is removed; configure those URLs explicitly via `introspection.providerConfig.<engine>.databaseUrl` or `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLSERVER_URL`.

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6
  - @askdb/rag@0.2.0-beta.12

## 0.2.0-beta.15

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/enrich@0.2.0-beta.6
  - @askdb/rag@0.2.0-beta.11
  - @askdb/postgres@0.2.0-beta.9

## 0.2.0-beta.14

### Minor Changes

- 75a51f7: Complete IA redesign with topbar, nav rail, URL-based routing (react-router v7), and modular view architecture replacing the monolithic App.tsx

### Patch Changes

- @askdb/postgres@0.2.0-beta.8

## 0.2.0-beta.13

### Minor Changes

- 36c35b4: Add AI-drafted tenant policy creation flow: new `POST /api/suggest-tenant-policy` endpoint analyzes schema DDL and proposes a complete tenant policy for user review; manual configuration fallback with table/column dropdowns; editable review screen for roots, hierarchy, scoped tables, polymorphic tables, global tables, enforcement mode, and documentation body before confirming. Add `writeTenantPolicyMarkdown` to `@askdb/core` for round-trip serialization of tenant-policy.md.
- f314b37: Revamp Studio with adaptive navigation, UX polish, and a Query Playground.

  **Adaptive sidebar navigation**: the left sidebar now adapts to the active view — Tables and Concepts show the searchable table list, Tenancy shows a six-section nav (Roots, Hierarchy, Scoped Tables, Polymorphic Tables, Global Tables, Policy Warnings) with count badges and smooth scroll-to-section on click.

  **Query Playground**: a new fourth main view with a two-column layout — question input and tenant controls on the left, generated SQL and results on the right. Every successful generation is automatically saved to `playground-history.json` in the schema artifact directory. The history sidebar lets you restore, compare, and re-run past queries. When `DATABASE_URL` is configured, an Execute button runs the generated SQL in a read-only transaction and renders a results table (truncated at 500 rows).

  **UX polish**: success and neutral status messages auto-dismiss after 4 s (errors persist until resolved). The sidebar collapses on small screens with a hamburger toggle in the main content area; on large screens it is always pinned.

  **New server endpoints**: `GET /api/history`, `POST /api/history`, `DELETE /api/history/:id` (file-backed persistence), and `POST /api/execute` (read-only Postgres execution via lazy `pg` load).

### Patch Changes

- b791213: Remove duplicate Ask panel from the right inspector and add multi-tenancy to the docs-site sidebar.

  The Ask/generate-SQL workflow now lives exclusively in the Playground view. The right-side inspector panel is simplified to two tabs — RAG and Status — and the `AskPanel` component is removed. The `Bot` icon import and the `"ask"` `PanelKey` are also dropped.

  The multi-tenancy docs page (`/multi-tenancy/`) is now linked from the docs-site sidebar under Reference, making it discoverable through navigation.

- 0d0040a: Improve multi-tenancy UI readability with collapsible sections, better hierarchy edge layout, and template-seeded documentation. Add chevron toggles to all sections in both the saved policy view and draft review view; verbose sections (scoped tables, polymorphic tables, global tables, table coverage, frontmatter preview) default to collapsed. Move FK info to its own line in hierarchy edges, and seed documentation textarea with markdown headings instead of placeholder.
- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16
  - @askdb/enrich@0.2.0-beta.5
  - @askdb/postgres@0.2.0-beta.7
  - @askdb/rag@0.2.0-beta.10

## 0.2.0-beta.12

### Minor Changes

- 4d8d87f: Add multi-tenancy Studio surfaces: Tenancy configuration main view with coverage report, tenant roots, hierarchy, scoped/polymorphic/global tables, and policy warnings; Ask panel tenant scope controls with JSON input, SQL output mode toggle, and tenant binding display.

## 0.2.0-beta.11

### Patch Changes

- c7026a8: Add guided concept editing in Studio and improve TUI concept authoring prompts.
- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14
  - @askdb/rag@0.2.0-beta.9
  - @askdb/enrich@0.2.0-beta.4
  - @askdb/postgres@0.2.0-beta.6

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5
  - @askdb/rag@0.2.0-beta.8

## 0.2.0-beta.9

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12
  - @askdb/rag@0.2.0-beta.7
  - @askdb/enrich@0.2.0-beta.3
  - @askdb/postgres@0.2.0-beta.5

## 0.2.0-beta.8

### Patch Changes

- eff2f5d: Fix alias, tags, and enum fields in the studio to allow spaces and multi-word entries. Previously, spaces were stripped and commas swallowed on every keystroke because `parseList` ran inside `onChange`. A new `ListInput` component holds the raw string locally and only parses on blur. AI suggestions now append to existing values rather than replacing them.
- Updated dependencies [cd364e3]
  - @askdb/postgres@0.2.0-beta.4

## 0.2.0-beta.7

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10
  - @askdb/rag@0.2.0-beta.6
  - @askdb/enrich@0.2.0-beta.2
  - @askdb/postgres@0.2.0-beta.3

## 0.2.0-beta.6

### Patch Changes

- 0084012: Add `ensureSchema()` to the pgvector adapter and auto-invoke it in Studio on every RAG operation, eliminating the "relation does not exist" error when pgvector is configured. Add `askdb-rag setup-store` CLI command for explicit schema provisioning in CI and production pipelines.
- Updated dependencies [0084012]
  - @askdb/rag@0.2.0-beta.5

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [0f9a8a9]
  - @askdb/rag@0.2.0-beta.4

## 0.2.0-beta.4

### Patch Changes

- 52cfa58: Honor the configured `rag.store` branch in Studio RAG flows and expose pgvector store metadata in Studio status.
- Updated dependencies [52cfa58]
  - @askdb/rag@0.2.0-beta.3

## 0.2.0-beta.3

### Patch Changes

- 9c01a6d: Running **`askdb enrich`** and **`askdb studio`** with no arguments now opens the schema directory resolved from `askdb.config` (`introspection.outputDir` → `ASKDB_INTROSPECT_OUT` env → `./askdb/`) instead of printing usage. Pass **`--schema <dir>`** to override, or **`--help`** for the command reference.

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/core@0.5.0-beta.4
  - @askdb/postgres@0.2.0-beta.2
  - @askdb/rag@0.2.0-beta.2
  - @askdb/enrich@0.2.0-beta.1

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1
  - @askdb/rag@0.2.0-beta.1
  - @askdb/postgres@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 48bfb62: Add `@askdb/studio`, a local browser UI for Schema v2 enrichment. Studio can browse tables and columns, edit describable metadata, save `tables/*.md`, request AI enrichment suggestions with the configured OpenAI-compatible key, and generate sample NL-to-SQL output against the saved schema enrichment.

  The main CLI now exposes `askdb studio --schema <dir>` as a shim for the Studio app. The shared TUI workspace save helper now creates `tables/` when needed so first-time describable files can be written from both UI surfaces.

- 373a9a7: Internal refactor: introduce shared web primitives (`CopyButton`, `EmptyText`) and a `lib/format` helper module for `@askdb/studio`. Pure additions — the new modules are not yet imported by `App.tsx`, so no published artifact changes and no release is required.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- 373e152: Add `@askdb/enrich` as the shared Schema v2 enrichment workspace package.

  Studio and TUI now both depend on `@askdb/enrich` for workspace loading,
  draft construction, markdown section updates, persistence helpers, and AI
  suggestion target/context builders. Studio no longer depends on `@askdb/tui`.

- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- 6df0045: Add a Sample NL question toggle for generating SQL with either the full saved schema or the current Studio RAG index, and show retrieved chunks when RAG is used.
- daa2625: Surface AI SDK token usage in Studio for RAG indexing, RAG queries, and sample SQL generation.
- 767fcf2: Refine the Studio request usage summary layout to emphasize prompt, completion, and total tokens.
- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [25980e4]
- Updated dependencies [373e152]
- Updated dependencies [ec3ae3d]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
- Updated dependencies [daa2625]
- Updated dependencies [6df0045]
  - @askdb/core@0.5.0-beta.0
  - @askdb/rag@0.2.0-beta.0
  - @askdb/config@0.3.0-beta.0
  - @askdb/enrich@0.2.0-beta.0
  - @askdb/postgres@0.2.0-beta.0

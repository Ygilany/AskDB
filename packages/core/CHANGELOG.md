# @askdb/core

## 1.0.0-beta.44

### Minor Changes

- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.

### Patch Changes

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- c610168: **CLI: `--help` / `--version` work without a config; friendly missing-config error.**
  
  - `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
  - `askdb --version` / `-V` is now supported and prints the package version.
  - When a command needs config and none exists, the CLI prints `No askdb.config.* or .config/askdb.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors (for example a config that fails to load) print their message and a hint; set `ASKDB_DEBUG=1` (or `true`) to include the stack trace. Other values, including `0`, and the `debug` package's `DEBUG` variable leave it off.
  - `askdb studio` / `askdb enrich` warn when `askdb.config.*` exists but fails to load, instead of ignoring it silently.
  
  **Docs:** the `@askdb/core` README states the pre-release beta status accurately.

## 1.0.0-beta.43

### Minor Changes

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

- ad9c9e5: **@askdb/core**: SQL validation now lexes SQL the way each database does, closing several read-only and sensitive-column bypasses. These checks are defense in depth, not a security boundary — run generated SQL under a read-only database role.

  A new internal dialect-aware lexer is shared by `validateSelectSql`, `validateSensitiveReferences`, and the placeholder scanner. It knows Postgres `E'…'` strings and exact-tag `$tag$…$tag$` quoting, that Postgres `"…"` has no backslash escape and `[` is an array subscript, MySQL backslash escapes (per `DialectSpec.backslashEscapes`) and `#` / `/*! … */` comments, SQL Server `[…]` with `]]`, and SQLite's quoting forms.

  `validateSelectSql` now rejects SQL it previously accepted:

  - Multi-statement and data-modifying-CTE payloads hidden behind engine-specific quoting (`E'\''`, `"x\"`, `$$ $ $$`, `ARRAY['a]']`, MySQL `'\''`, MySQL `#` comments).
  - `SELECT … INTO` on every dialect, including MySQL `INTO OUTFILE` / `INTO DUMPFILE` (`into` and `merge` join the shared keyword denylist).
  - SQL Server statement verbs that run without a semicolon (`SHUTDOWN`, `WAITFOR`, `KILL`, `BACKUP`, `RESTORE`, `DBCC`, `RECONFIGURE`, `DENY`, `BULK`, `USE`, `SET`, `OPENDATASOURCE`, …).
  - Calls to side-effecting functions listed in the new `DialectSpec.blockedFunctions` (new rule `SQL_FORBIDDEN_FUNCTION`): e.g. Postgres `pg_sleep`, `set_config`, `pg_read_file`, `lo_import`/`lo_export`, `dblink_exec`, `pg_terminate_backend`, `nextval`; MySQL `SLEEP`, `BENCHMARK`, `LOAD_FILE`; SQLite `load_extension`.
  - Unterminated strings, quoted identifiers, dollar-quotes, and block comments (new rule `SQL_UNTERMINATED`) — previously accepted silently.
  - More than one trailing semicolon (`SELECT 1;;`), a quoted `"select"` as the first token, and `--` / `/*` sequences that MySQL lexes as operators.

  Keywords are matched on whole unquoted tokens, so `created_into`, `copy_count`, `"delete"`, and `'delete me'` still pass. A `DialectSpec` whose `id` is not a built-in family must pass under every built-in lexer and denylist.

  `validateSensitiveReferences` gains an optional `dialect` option and now reports `SELECT *`, `alias.*`, and whole-row references (`row_to_json(u)`, `to_jsonb(u)`, `json_agg(u)`) as referencing the table's sensitive columns. Without `dialect`, references are unioned across every built-in engine's reading. An unterminated token is reported as the new `UNTERMINATED_TOKEN` scope issue.

  `SELECT *` is recognized after each engine's `SELECT` modifiers (MySQL `DISTINCTROW`, `HIGH_PRIORITY`, `STRAIGHT_JOIN`, `SQL_NO_CACHE`, …; Postgres `DISTINCT ON (…)`; SQL Server `TOP n [PERCENT] [WITH TIES]`), closing a bypass where those modifiers hid the wildcard; without `dialect`, every engine's modifiers are accepted. Fewer false positives: `SELECT percent * rate` is multiplication, and an implicit output alias (`SELECT id u FROM users u`) is no longer reported as a column or whole-row reference.

  `SELECT *`, `alias.*`, and whole-row references now expand per query block: a bare `*` reaches only its own `SELECT`'s `FROM`/`JOIN` tables (not a subquery's or another `UNION` branch's), and an alias resolves in its own block before enclosing ones; when the block structure cannot be read, they expand statement-wide as before. A MySQL `/*! …` executable comment that never closes is now reported as unterminated (`SQL_UNTERMINATED`, `UNTERMINATED_TOKEN`).

  Also: `SqlValidationRuleCode` adds `SQL_FORBIDDEN_FUNCTION` and `SQL_UNTERMINATED`; `SensitiveScopeIssue` adds `UNTERMINATED_TOKEN`. Placeholder scanning no longer reads the type in a `value::type` cast, or text inside a comment, as a `:name` placeholder.

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

- 764ec32: **@askdb/core**: tenant enforcement now fails closed in three cases where it used to pass silently. Each change is stricter than before: SQL or schema artifacts that used to load or return can now throw.

  - **The tenant guardrail checks the SQL `ask()` returns.** Before, the check ran on the model's `sql-unbound` block when one was present. When that block disagreed with the bound `sql` block, `ask()` dropped the unbound extras but kept the passing guardrail result, so unscoped SQL could come back with `tenantGuardrail.passed === true`. `ask()` now runs the guardrail on `result.sql` after tenant placeholder substitution, plus `result.unboundSql` when it is kept. Under `strict` a failure throws `TenantGuardrailError`; under `warn` it is reported in `tenantGuardrail.warnings`. When `generateSelectSql()` is called directly, it now checks both the bound and the unbound SQL it returns.
  - **Custom `AskDialect` adapters no longer skip tenant enforcement.** When the schema has a tenant policy, `ask()` runs the tenant guardrail on the final SQL for every dialect form. A `tenantGuardrail` returned by a custom adapter is merged in; it can add failures but cannot replace the check. Custom adapters are still responsible for their own SELECT-only validation (use `validateSelectSql`). An unknown string dialect id now throws the new `UnknownDialectError`, which extends `AskDbError`, instead of a plain `Error`.
  - **A broken `tenant-policy.md` is a load error.** Before, `loadSchema()` ignored any non-`SchemaParseError` failure while reading `tenant-policy.md`. Malformed YAML front-matter, which gray-matter throws as a `YAMLException`, therefore loaded the schema with no tenant policy, and `ask()` applied no scope. Now only a missing file is ignored. Any other read or parse failure throws `SchemaParseError` naming the file, and `tables/*.md` and `concepts.md` follow the same rule (a malformed `concepts.md` used to be silently skipped). Bundles follow the same rule: only an absent `tenantPolicy` or `concepts` key means "no file". An empty string used to be treated as "no policy" and now fails validation with `SchemaParseError`, as do `null` and other non-string values. `parseTenantPolicyMarkdown`, `parseTableMarkdown`, and `parseConceptsMarkdown` also report malformed YAML as `SchemaParseError`. `loadSchema("<dir>/schema.json")` now loads the enclosing directory, including sibling `tables/*.md`, `concepts.md`, and `tenant-policy.md`, exactly as `loadSchema("<dir>")` does. Other JSON file names are still loaded as a standalone physical layer; use `loadSchemaFromJson()` if you want only the physical layer.

- cb7dec5: **Behavior change: `subtree` tenant scopes now include descendants.** Previously `ask()` with `tenantScope.access.kind: "subtree"` scoped the SQL to the named `rootIds` only and never expanded the hierarchy, so an agency admin silently got none of the rows beneath their agency. `ask()` now expands the subtree before generation, so the same call returns rows for the whole subtree. That is what `subtree` always promised, but the returned data changes.

  **`subtree` without a resolver now throws** instead of silently under-scoping. AskDB never opens a database connection, so the host supplies the expansion through a new `ask()` option (also accepted as an `@askdb/client` per-call override):

  ```ts
  type TenantIdsByRoot = Readonly<Record<string, readonly string[]>>;

  resolveTenantDescendants?: (
    tenantRoot: string,
    seedIds: readonly string[],
  ) => Promise<TenantIdsByRoot> | TenantIdsByRoot;
  ```

  It receives `access.tenantRoot` and `access.rootIds` and returns the subtree's IDs grouped by tenant root, keyed by root table ID: the seeds and any same-table descendants under `tenantRoot`, and each descendant root's IDs (through the policy's `roots[].parent` or `hierarchy`) under that root. For example, `{ "table:public.agencies": ["1"], "table:public.sub_agencies": ["5"], "table:public.clients": ["5"] }`. Root tables have separate ID spaces, so `ask()` binds each root's IDs only to that root's own `:tenant_<label>_ids` placeholder: the expanded scope is a `multi_root` scope, or an `ids` scope when only `tenantRoot` has IDs. `ask()` unions the seeds into the `tenantRoot` entry, so an ancestor keeps its own rows even when the resolver returns strict descendants only.

  A `subtree` scope with no resolver, or a resolver that returns an array, a key that isn't a tenant root in the subtree, a value that isn't an array of non-empty strings, or no IDs at all, throws `TenantScopeError` with the new reason `SUBTREE_NOT_RESOLVABLE`, before the model is called. The `ids`, `multi_root` and `global` access kinds are unchanged.

  New exports: the `ResolveTenantDescendants` and `TenantIdsByRoot` types, and `expandClosure(seedIds, childrenOf)`, a breadth-first, cycle-safe closure over one root's in-memory hierarchy for use inside a resolver. `resolveTenantSql()` and `buildTenantPromptBlock()` do not expand a `subtree`, so direct callers must pre-expand it into a `multi_root` access.

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

- 41f1ed6: **Behavior change (security): the tenant guardrail now requires a tenant predicate that filters.** Before, a tenant-scoped table passed once its tenant column's name, or the placeholder, appeared anywhere in the SQL. So strict mode returned SQL that leaked other tenants' rows: the column selected but never filtered, a literal ID for another tenant (`agency_id = 1`), `agency_id = :tenant_agency_ids OR 1 = 1`, and the tenant root table read with no filter (#315, found by the consumer lab on five engines).

  A table now needs its tenant column compared with its root's placeholder (`= :tenant_<root>_ids`, `IN (…)` or `= ANY(…)`), ANDed into a `WHERE`, inner-join `ON` or `HAVING` clause, in every `UNION` branch that reads it (including inside derived tables and CTEs). It fails next to an `OR`, `XOR` (or MySQL `||`) at any enclosing level, under `NOT`, in the select list or a `CASE`, in an outer join's `ON` (join hints included) or an `OUTER APPLY`, inside `EXISTS (…)` or a scalar subquery, and as a literal ID. Down a hierarchy, the predicate must be on a column that carries the IDs of the path's root or one of its ancestors (a root outside that chain doesn't count, even one the scope binds), and a qualifier naming another table rules it out. A root table the scope covers needs the same predicate on its tenant ID column. Polymorphic tables need it on their id column, plus `typeColumn = '<key>'` ANDed into the same query block, where the key maps to the root whose placeholder filters the id column. On MySQL and MariaDB, `--` starts a comment only before whitespace, and a `/*! … */` executable comment's body is read both as code and as a comment. Parenthesized set-operation operands (`(SELECT …) UNION ALL (SELECT …)`) are checked as query blocks. Strict mode rejects SQL it used to return; warn mode reports the same findings in `result.tenantGuardrail`.

  `ask()` now runs the check on the model's SQL **before** tenant rendering, with the `:tenant_<root>_ids` placeholders still named, as `generateSelectSql()` already did. So one rule covers every `tenantSqlMode` and dialect. If you call `validateTenantGuardrails()` directly, pass it that form: SQL whose tenant IDs are already substituted as literals or markers no longer passes.

  The check is still a heuristic, not a parser (see "Guardrail validation" in `docs/contracts/tenant-policy.md`). Keep database-side row-level security and a read-only role as the real boundary.

### Patch Changes

- 1338535: **@askdb/core**: `ask()` now passes its dialect to `validateSensitiveReferences`, so the sensitive-column check lexes the returned SQL the way the target engine does instead of unioning every engine's reading. Custom `AskDialect`s (no `DialectSpec`) keep the conservative union. Tenant placeholder substitution (`resolveTenantSql`, `extractTenantPlaceholders`, `resolvePlaceholders`) also uses the dialect's lexer, so a `:tenant_*_ids` placeholder inside a MySQL backslash-escaped string literal or a MySQL `#` comment is left untouched, matching `bindPreparedQuery`. The case-variant placeholder check (`:TENANT_…` spellings are rejected) reads the same code regions with the same dialect, and no longer mistakes a `::type` cast for a placeholder.

  **@askdb/studio**: Playground execute's sensitive-column warnings lex the SQL with the execute engine's dialect.

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 5e89384: **@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) now opens by calling the check a best-effort lint, and says it is not a SQL parser and not a security boundary, with real tenant isolation coming from the database, and that `global` scope skips it. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

  **@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

  **askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.

- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

## 1.0.0-beta.42

### Minor Changes

- 595182d: **@askdb/core**: `ask()` now returns optional `unboundSql`, `params`, `parameters`, and `preparedQuery` alongside the existing bound `sql` when the model emits a consistent unbound block and parameter manifest (`parameterize` defaults to `true`; set `false` to opt out of the extra output tokens). New exported `bindPreparedQuery()` rebinds a `PreparedQuery` locally with no model call. `DialectSpec` gains `listBinding` and `backslashEscapes`; MySQL/MariaDB literal escaping now doubles backslashes so a value ending in `\` cannot break out of its string. If the model's extras are missing or inconsistent, they are dropped and `result.sql` is unaffected — callers who never read the new fields see today's behavior.
- 1af6263: **@askdb/core**: promote the sensitive-identifier SQL check out of the CLI into core as a public, enforceable API, and fix its false-positive problem.

  New export `validateSensitiveReferences(sql, schema, options?)` reports the `sensitive` tables and columns a SQL statement references, returning `{ passed, references, unresolvedScope? }` — the same shape as `TenantGuardrailResult`. Each reference carries `matchKind: "qualified" | "unqualified" | "table"`. `{ mode: "strict" }` throws the new `SensitiveReferenceError extends AskDbError` with a `SensitiveReferenceRuleCode`; `{ mode: "warn" }` (the default) returns without throwing.

  `sensitive: true` was previously prompt-level only — `formatSchemaForNlToSql` tags or withholds identifiers, which constrains what the model _sees_ but not SQL that reaches execution by another route (a host SQL cache, a replayed statement, a regenerated artifact). `validateSensitiveReferences` is the enforcement path and is exported standalone so it can run on stored SQL with no model in the loop.

  **Fixes the unqualified matcher.** The CLI's private implementation regex-tested each sensitive column name anywhere in the statement, so any table-level-`sensitive` table with a common column (`id`, `name`, `tag`) flagged every benign query. Unqualified names now count only when the owning table is actually in the statement's scope: `FROM`/`JOIN` targets and their aliases are resolved first, including inside CTEs and derived tables, and string literals and comments are excluded. When scope cannot be proven the check fails conservatively and says why via `unresolvedScope`, mirroring how `validateTenantGuardrails` handles unprovable scope.

  `ask()` runs the guardrail over the SQL it returns and attaches `AskPipelineResult.sensitiveGuardrail`; the new `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default — not a breaking change), `"strict"`, or `"off"`. Reuses the existing `askdb.pipeline.sensitive_sql_warning` log event, now exposed as `AskDbLogEvent.PipelineSensitiveSqlWarning`. Also exports `schemaHasSensitiveIdentifiers` and `formatSensitiveReference`.

  **askdb**: `askdb ask` now renders the guardrail result from `ask()` instead of its own private copy of the check, so there is one implementation. The warning no longer fires on unrelated queries that merely share a column name with a sensitive table, and schema-qualified schemas now print `schema.table.column`. Unresolvable statement scope is surfaced as a `Note:` line.

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

## 1.0.0-beta.41

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

## 1.0.0-beta.40

### Patch Changes

- 350c03a: Normalize AI SDK 6 input and output token usage into the `promptTokens` and
  `completionTokens` values returned by `ask()`.

## 1.0.0-beta.36

### Minor Changes

- 7311ac5: Surface token usage through the full AskDB stack and add comprehensive API reference documentation.

  **@askdb/core** — new `AskUsage` type (`promptTokens`, `completionTokens`, `totalTokens`); `generateSelectSql` now captures token usage from the `generateText` result; `AskDialectGenerateResult` and `AskPipelineResult` both include `usage?: AskUsage`; exported from the package index.

  **@askdb/http-api** — `POST /ask` success response now includes `usage: AskUsage | null`.

  **@askdb/studio** — Token usage re-added to the Query Playground (was dropped in the IA redesign migration); `UsageSummary` extracted to a shared component used by both the Playground and RAG Index page; display now correctly shows Prompt, Completion, and Embeddings rows individually.

## 1.0.0-beta.26

### Patch Changes

- baf5ad8: Refresh dependency ranges across the workspace.

## 1.0.0-beta.21

### Patch Changes

- dda0abf: Persist ignored table metadata and keep ignored table references out of RAG concept and relationship chunks.

## 1.0.0-beta.20

### Minor Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

## 0.5.0-beta.18

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

## 0.5.0-beta.16

### Minor Changes

- 36c35b4: Add AI-drafted tenant policy creation flow: new `POST /api/suggest-tenant-policy` endpoint analyzes schema DDL and proposes a complete tenant policy for user review; manual configuration fallback with table/column dropdowns; editable review screen for roots, hierarchy, scoped tables, polymorphic tables, global tables, enforcement mode, and documentation body before confirming. Add `writeTenantPolicyMarkdown` to `@askdb/core` for round-trip serialization of tenant-policy.md.

## 0.5.0-beta.14

### Minor Changes

- c3c0f21: Add Phase 10 multi-tenant isolation proof.

  `@askdb/core` gains a complete tenant isolation pipeline:
  - **Tenant policy format**: `tenant-policy.md` with YAML front-matter (roots, hierarchy, scoped tables, polymorphic mappings, global tables, enforcement mode) and markdown body for business context.
  - **Runtime `TenantScope`**: Unified scope input on `ask()` with four access kinds (`ids`, `subtree`, `multi_root`, `global`), optional `tenantFilters`, and advisory `context`. Fail-closed when policy exists but scope is missing.
  - **Prompt assembly**: Tenant policy block always injected into NL→SQL prompts (security boundary) with hierarchy, scoped table paths, named placeholders, and enforcement rules.
  - **SQL guardrails**: Heuristic validation checks scoped tables for tenant predicates, polymorphic tables for type discriminators, and unknown tables. Configurable `strict` (throw) vs `warn` (return warnings) enforcement.
  - **SQL output modes**: `tenantSqlMode` option — `"sql-only"` (default) inlines literal values with `=` → `IN` rewriting; `"sql-params"` converts to positional `$N` parameters. Result includes `tenantBindings` and `tenantParams`.
  - **Schema evolution**: New tables classified as `unknown`; orphaned table/column/FK references flagged as warnings.

  `@askdb/rag` adds `"tenant-policy"` as a chunk type. The chunker emits one chunk per H2 section from `tenant-policy.md` body. Source loaders (directory and bundle) now load tenant policy. `synthesizeRetrievedDdl` includes retrieved tenant policy context in focused prompts.

## 0.5.0-beta.12

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

## 0.5.0-beta.10

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

## 0.5.0-beta.4

### Minor Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- a4f14f7: **`MYSQL_DIALECT`, `MARIADB_DIALECT`, `SQLITE_DIALECT`, and `SQLSERVER_DIALECT` ship in `@askdb/core`.** All four are registered in `BUILT_IN_DIALECTS` and exported from `@askdb/core`; `ASKDB_DIALECTS` in `@askdb/config` is expanded accordingly so `askdb.config.dialect` autocompletes for every shipped spec.

  **Auto-selection now covers every Prisma provider.** A Prisma user pointed at `mysql`, `sqlite`, or `sqlserver` no longer gets the "AskDB does not yet ship a DialectSpec" error — `askdb introspect` writes the detected provider into `schema.json`, and `askdb ask` (and the HTTP API / Studio) auto-picks the matching dialect.

  **Prompt briefs.** Each spec carries a one-paragraph syntax brief covering quoting, casting, date/time helpers, string concat, and row-limit clauses. Examples: MySQL prompts for `CONCAT()` (since `||` is logical OR), SQL Server for `TOP n` / `OFFSET … FETCH NEXT` (no `LIMIT`), SQLite for `strftime()` and dynamic typing. `SELECT *`-style read-only shape checks (single statement, no comments, no DDL/DML keywords) remain centralized; per-dialect denylists add `ATTACH`/`DETACH`/`PRAGMA`/`REINDEX` (SQLite) and `EXEC`/`MERGE`/`OPENROWSET` (SQL Server).

## 0.5.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 289e63e: First public pre-1.0 release.

  `@askdb/core` ships the NL→SQL pipeline (`ask`), the BYO executor seam
  (`AskDbExecutor`, `TabularResult`), and the validated read-only PostgreSQL
  guardrail. `pg` is an **optional peer dependency** — consumers using a custom
  `executor` never need to install it. The built-in helpers live behind the
  `@askdb/core/postgres` subpath and lazy-load `pg` on first invocation, with a
  helpful error if the peer is missing.

  `@askdb/cli` (`askdb` binary) and `@askdb/http-api` (`askdb-http` binary,
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
  - The `askdb-introspect` standalone binary and the `@askdb/introspect/cli` and `@askdb/introspect/postgres` subpaths are removed. Use `askdb introspect` from `@askdb/cli`, and import the connector from `@askdb/postgres`.

  **New — `@askdb/postgres`**
  - New package bundling the Postgres dialect (`postgresDialect`, `generatePostgresSelectSql`, `validatePostgresSelectSql`), the connector (`createPostgresConnector`, live + from-export), the catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`), the bundle reader, and the `pg`-backed catalog runner (`createPostgresCatalogQueryRunner`).
  - `pg` is an optional peer dependency, lazy-loaded only when live catalog introspection is invoked.

  **Pre-1.0 breaking — apps**
  - `@askdb/cli` now wires `postgresDialect` internally. The `askdb introspect` subcommand replaces the retired `askdb-introspect` binary.
  - `@askdb/http-api` no longer accepts execution controls or `connectionString` in request bodies. It returns generated SQL only.
  - `apps/{cli,http-api,tui,docs-site}` moved from `packages/*` to `apps/*`. Repository `directory` metadata updated accordingly.

- fdfd059: Add the Phase 7 `@askdb/tui` enrichment package and CLI shims.

  `@askdb/tui` provides the `askdb-tui` binary for editing Schema v2 table descriptions,
  aliases, column metadata, common query language, example questions, and concepts.
  It includes AI suggestion helpers with human confirm-before-save and a `bundle`
  command that emits loader-compatible single-file Schema v2 JSON artifacts.

  `@askdb/core` now exports enrichment-suggestion prompt helpers for BYO
  `LanguageModel` integrations. `@askdb/cli` adds `askdb enrich` and `askdb bundle`
  shims that delegate to `askdb-tui` when installed.

- b018d88: Add the Phase 8 RAG layer.

  `@askdb/rag` ships deterministic Schema v2 chunking, BYO embedder and vector store interfaces, in-memory/file/pgvector stores, lock-file based index reuse, and the `askdb-rag` CLI.

  `@askdb/core` now accepts an optional `retriever` in `ask()`. When retrieval is used, core synthesizes a focused DDL block from retrieved schema chunks; without a retriever the existing full-DDL prompt path is preserved.

- 4e462eb: Remove generated-SQL execution from AskDB package surfaces.
  - `@askdb/core` no longer exports `AskDbExecutor` / `TabularResult`, no longer accepts `execute` or `executor`, and `ask()` now returns generated SQL only.
  - `@askdb/introspect` now owns the introspection-only `CatalogQueryRunner` / `CatalogQueryResult` contract for connector catalog reads.
  - `@askdb/postgres` replaces `createPostgresExecutor` / `executeReadOnlySelect` with `createPostgresCatalogQueryRunner` for live introspection.
  - `@askdb/cli` and `@askdb/http-api` no longer execute generated SQL; old execution controls are rejected.

- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- cd23f50: **Breaking change (pre-1.0):** Schema v2 replaces the previous format. `loadSchema()` and `loadSchemaFromJson()` are the new entry points; the pre-v2 format is rejected with a clear error pointing at `docs/contracts/schema-v2.md`.

  New exports: `loadSchema`, `loadSchemaFromJson`, `parseTableMarkdown`, `parseConceptsMarkdown`, `writeTableMarkdown`, `writeConceptsMarkdown`, `formatSchemaV2ForNlToSql`, and all v2 types. `ask()` now accepts both `NormalizedSchema` (legacy) and `NormalizedSchemaV2`.

  CLI and HTTP API transparently pick up Schema v2 — pass a v2 directory path to `--schema` / `ASKDB_SCHEMA_PATH`.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- 25980e4: Centralize optional `askdb.config` defaults in `flattenAskDbConfig` instead of `optionalEnv`. `env()` now returns `undefined` when unset; add `requiredEnv` for fail-fast reads. Introduce `defaults.ts`, align the default RAG file-store path with `./askdb/rag`, and emit `ASKDB_PGVECTOR_INDEX_STRATEGY` when flattening pgvector. Refresh the `askdb init` template, root `askdb.config.ts`, and documentation.

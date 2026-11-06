# @askdb/core

## 1.0.0-beta.46

### Minor Changes

- b40309d: **Breaking: enrichment targets take loaded tables** (#667, ADR 0026). `EnrichmentTarget.table` and `EnrichmentContext.neighbors` are now `NormalizedV2Table`, the table type in `loadSchema()`'s result, instead of `V2Table`, the table as `schema.json` stores it. Before, a host could pass `suggestEnrichment()` or `buildEnrichmentUserPrompt()` a table read straight from `schema.json`, which lacks front-matter sensitivity: with `omitSensitiveIdentifiersFromPrompt` on, a column marked sensitive only in `tables/*.md` was named in the prompt, and a suggestion for it wasn't refused. The compiler now refuses such a table. Runtime behavior is unchanged.
  
  **What a host must change:** build the target and context from `loadSchema()`'s result, with `@askdb/enrich`'s `buildSuggestionTarget(schema, source)` and `buildSuggestionContext(schema, tableId)` or from `schema.tables`. A table you build by hand must set `sensitive` on the table, and `sensitive` and `primaryKey` on every column; mark sensitive each column that `tables/*.md` marks, and every column of a sensitive table, as `loadSchema()` does. `loadSchemaFromJson()` of a bare `schema.json` typechecks too, but has no front-matter flags, so load the schema directory or a bundle with `loadSchema()`. Studio and hosts that already use the `@askdb/enrich` builders need no change.
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
- 234eec0: - **A wrong-case schema file name throws instead of being skipped.** `loadSchema()` now throws `SchemaParseError` when a schema directory holds `Tenant-Policy.md`, `Concepts.md`, `Tables/`, `tables/<name>.MD`, or (for a directory path) `Schema.json`. The error names each rename, for example `rename Tenant-Policy.md to tenant-policy.md`, or says to keep one when both spellings exist (possible only on Linux). Before, on Linux (case-sensitive), the loader skipped those files: a skipped `tenant-policy.md` loaded the schema with no tenant policy, so `ask()` stopped requiring a `tenantScope`, and nothing reported an error. A `tables/*.MD` file was skipped on every OS, with every `sensitive: true` in it. The check runs on every OS, so a directory that loaded on macOS or Windows with a wrong-case name now throws there too. Rename the file to fix it. A path you pass is still read as given, so `loadSchema("<dir>/Schema.json")` loads as before. See ADR 0027.
  - **An optional file is absent only when the directory doesn't list it.** A listed `tenant-policy.md`, `concepts.md`, `tables/` or table file that can't be read now throws, including a symbolic link whose target is missing, which used to load as "no file".
  - **The stray-JSON check counts a sibling in any case.** On Linux, `loadSchema("<dir>/prod-schema.json")` beside `Tenant-Policy.md` loaded with no tenant policy. It now throws, as it already did beside `tenant-policy.md` (ADR 0019).
  - **New `readSchemaDirectory(dir)`** in `@askdb/core` reads a schema directory into its `BundledSchemaV2` bundle form. `loadSchema()` reads every directory through it.
  - **`@askdb/enrich`'s `bundleSchemaDirectory()` returns `readSchemaDirectory()`**, so `askdb bundle` refuses the same directories `loadSchema()` refuses, instead of writing a bundle without a wrong-case `Tenant-Policy.md`. Its errors are now `SchemaParseError`s from core, where a failed read used to throw the raw Node error. `loadWorkspace()` (Studio) refuses such a directory too, through its `loadSchema()` call. Minor: these directories used to be accepted.
  - Docs: the core API reference covers `readSchemaDirectory()` and the exact-name rule; troubleshooting covers the new error; the CLI reference notes that `askdb bundle` refuses such a directory.
- 0f4246c: **Breaking: a rebind checks and renders under the dialect rules `ask()` ran with, or refuses** (#660, ADR 0032). Before, `bindPreparedQuery()` always used the built-in spec for the template's `dialect`, so a host's `backslashEscapes`, `blockedFunctions`, `extraForbiddenKeywords` and `extraValidate` were dropped at rebind: under `{ ...POSTGRES_DIALECT, backslashEscapes: true }`, the value `\' OR 1=1 --` rebound as `'\'' OR 1=1 --'` with verdict `allow`. `ask()` now records `preparedQuery.dialectRules`: `"builtin"` for a built-in id or the exported constant, `"host"` for any other `DialectSpec` object. `BindGuardrails` takes a new `dialect` (a `DialectSpec` or a built-in id, with the template's `id`), used for the checks, the rendering and the final validation.
  
  **What a host must change:** if you pass your own `DialectSpec` to `ask()`, pass the same spec as `dialect` when you rebind; without it, `bindPreparedQuery()` throws `QueryParameterError` (`DIALECT_SPEC_REQUIRED`). A template stored before this release has no `dialectRules` and throws the same error until you pass `dialect`; if `ask()` ran with a built-in id, the id is enough (`dialect: "postgres"`). A template you build by hand has no `dialectRules`, so it needs `dialect` too. A `dialect` with another `id` throws `QueryParameterError` (`DIALECT_UNSUPPORTED`). An app that loads two copies of `@askdb/core` gets `"host"` templates from the other copy's constants, and passes `dialect` too.
- 96f36ef: **Breaking: a rebind binds tenant IDs as driver parameters by default, as `ask()` does** (#664, ADR 0024). `BindGuardrails` takes `tenantSqlMode`, default `"sql-params"`: with a tenant scope, the `sql` that `bindPreparedQuery()` returns keeps the business values inlined and holds the tenant IDs as driver markers (`$1`, `?` or `@p0`, numbered from the first slot), and the new `BoundQuery.tenantParams` holds the IDs. So a tenant ID that no literal carries safely, such as `agência` or one with a backslash, now rebinds; before, the rebind threw `UNESCAPABLE_TENANT_ID` for it. `"sql-only"` inlines the IDs as before, and refuses such an ID. `unboundSql` + `params` don't change, and without a tenant policy `sql` doesn't change. A `tenantSqlMode` that is neither mode throws `TenantScopeError` (`TENANT_SQL_MODE_REQUIRED`).
  
  **What a host must change:** with a tenant scope, run the rebound `sql` with `tenantParams` (`pool.query(rebound.sql, rebound.tenantParams ?? [])`), or run `unboundSql` with `params`. Running `sql` alone now fails at the driver; it never returns other tenants' rows. To keep inlined IDs, pass `tenantSqlMode: "sql-only"`.
- cdab7d7: - **Locking reads are rejected on every engine, with a new rule code** (#319). `validateSelectSql`, and so `ask()`, `generateSelectSql()` and `bindPreparedQuery()`, throws `SqlValidationError` with rule `SQL_LOCKING_READ` for `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` and `LOCK IN SHARE MODE` anywhere in the statement, subqueries and CTEs included. On SQL Server, it also rejects the table hints `UPDLOCK`, `XLOCK`, `HOLDLOCK`, `PAGLOCK`, `TABLOCK`, `TABLOCKX`, `ROWLOCK`, `SERIALIZABLE` and `REPEATABLEREAD` as unquoted words anywhere, inside `WITH (…)` or without it, and quoted when one stands alone in parentheses right after a name, at any depth and with trailing spaces (`FROM t ([UPDLOCK])`, `t (("UPDLOCK "))`), which SQL Server also reads as the hint. SQL Server compares hint names loosely (it reads `UPDʟOCK` as `UPDLOCK`), so on SQL Server every unquoted name must also be printable ASCII, and so must a quoted name alone in parentheses after a name. `NOLOCK`, `READUNCOMMITTED`, `READPAST`, `READCOMMITTEDLOCK` and `NOWAIT` still pass. Before, `SELECT … WITH (UPDLOCK)`, `FOR SHARE` and `LOCK IN SHARE MODE` passed, and the host's transaction then held their locks.
  - `SqlValidationRuleCode` adds `SQL_LOCKING_READ`, and `buildSelectGuardrailExplanation()`'s `checksVerified` adds `no_locking_reads`.
  - On SQL Server, the NL→SQL prompt quotes a schema, table or column named like one of those hints (`[rowlock]`). It already quoted names that aren't plain ASCII there (`[Größe]`), and now does for a dialect id that is no built-in engine too. On both, the prompt has a new line telling the model to quote a non-ASCII alias (`AS [注文数]`) and to qualify a quoted column that is alone in parentheses (`SUM(o.[金額])`).
  - **Upgrade notes (breaking):**
    - `FOR UPDATE` and `FOR NO KEY UPDATE` now throw `SQL_LOCKING_READ`, not `SQL_FORBIDDEN_KEYWORD`. Code that matches the old rule code for them needs the new one.
    - SQL that passed before and now throws: `FOR SHARE`, `FOR KEY SHARE` and `LOCK IN SHARE MODE` on every engine, and the nine SQL Server hints, also on a dialect id that is no built-in engine.
    - On SQL Server (and dialect ids that are no built-in engine), an unquoted name that is one of the nine hint words throws; quote it (`[rowlock]`), and qualify it too when it's the only thing inside parentheses (`COUNT(t.[rowlock])`, not `COUNT([rowlock])`). `HOLDLOCK` was already a T-SQL reserved word.
    - On SQL Server (and dialect ids that are no built-in engine), an unquoted name that isn't printable ASCII throws `SQL_LOCKING_READ`; quote it (`[Größe]`), and qualify it when it's the only thing inside parentheses (`COUNT(t.[Größe])`). This narrows the plain-code rule from #327, which let Unicode letters through in unquoted code. A dialect id that quotes with a backtick can't use such names, or hint-named ones, yet (#672).
    - Code that switches over every `SqlValidationRuleCode` member needs a case for `SQL_LOCKING_READ`.
  - Docs: Safety boundaries lists the locking forms and says the check is defense in depth: the connection's isolation level still decides what a plain `SELECT` locks. Troubleshooting has a `SQL_LOCKING_READ` entry, the check summaries elsewhere name it, and Studio's Execute section lists locking reads among the queries it rejects.
- ed7f35c: Remove public exports that nothing in AskDB calls and no page documents, before the 1.0 API freeze (#356, ADR 0031).
  
  **Upgrade notes (breaking):**
  
  - `@askdb/core`: `formatSchemaForPrompt(schema, options)` is removed. Call `formatSchemaForNlToSql(schema, options).ddl`, which returns the same string.
  - `@askdb/config`: `DEFAULT_LOCAL_POSTGRES_URL` is removed, with no replacement. Write your own local connection string.
  - `@askdb/enrich`: `hasAnyColumnDescribable`, `isEnumCandidate`, `parseListInput` and `formatList` are removed, with no replacement. In place of `parseListInput(value)`, use `value.split(",").map((s) => s.trim()).filter(Boolean)`; in place of `formatList(list)`, use `list?.join(", ") ?? ""`.
  
  Internal cleanup with no API change: core's tenant-policy loader drops two unused helpers, and Studio's web app drops the unused `Drawer` and `Panel` components, the Drawer CSS and four unused formatting helpers.
- 4d6a315: **Breaking: AskDB inlines a tenant ID only when it is printable ASCII without a backslash**, on every dialect (#360, #371, ADR 0024). `ask()` and `resolveTenantSql()` in `tenantSqlMode: "sql-only"`, and `bindPreparedQuery()` (whose `sql` always inlines tenant IDs), throw `TenantScopeError` with reason `UNESCAPABLE_TENANT_ID` for any other ID instead of returning SQL. Before, the ID was escaped for the dialect, or only had its quotes doubled for a custom `AskDialect`, and the literal could end early on the server. On Postgres with `standard_conforming_strings = off`, the ID `x\' OR 1=1 --` made a scoped query return every row. Under a MySQL or MariaDB connection charset of `sjis`, `cp932` or `ujis`, `2¥' OR 1=1 --` did the same, because `¥` is sent as a backslash. Printable-ASCII IDs without a backslash are unchanged. A control character in a tenant ID now throws this `TenantScopeError` rather than `QueryParameterError`. **What a host must change:** with tenant IDs outside printable ASCII (for example `café` or `東京`), call `ask()` in `tenantSqlMode: "sql-params"` (the default), which passes any ID as a driver parameter. `bindPreparedQuery()` can't rebind such an ID yet (#664).
- 4d6a315: **Breaking: tenant IDs are driver parameters by default** (`tenantSqlMode: "sql-params"`, #231, ADR 0024).
  
  **What a host must change:** if you pass `tenantScope` to `ask()` (or `askdb.ask()` in `@askdb/client`, which forwards to it) without `tenantSqlMode`, `result.sql` now holds the dialect's driver markers (`$1`, `?` or `@p0`) where the tenant IDs used to be inlined, and the IDs are in `result.tenantParams`. Run `result.sql` with `result.tenantParams`, or `result.unboundSql` with `result.params` (which already holds the tenant IDs); never concatenate the two arrays. To keep the old output, set `tenantSqlMode: "sql-only"`. Running the new `sql` without its params fails at the driver (Postgres: "there is no parameter $1"; better-sqlite3: "Too few parameter values"; MySQL: a syntax error). It never returns other tenants' rows.
  
  **A custom `AskDialect`, or a `DialectSpec` whose `id` isn't built in, has no default.** With a tenant scope and no `tenantSqlMode`, `ask()` now throws `TenantScopeError` with the new reason `TENANT_SQL_MODE_REQUIRED`, before any retrieval or model call. AskDB can't know which parameter markers such a dialect's driver takes, and the `$N` markers it would emit are money constants on SQL Server, where `agency_id = $1` runs and matches agency 1. Set `tenantSqlMode: "sql-params"` if your driver binds `$1`-style markers, or `"sql-only"` to keep the IDs inlined. On any dialect, `ask()` with a tenant scope and `resolveTenantSql()` now throw the same reason for a `tenantSqlMode` that is neither of the two (for example `"sql_only"`) instead of treating it as `"sql-params"`.
  
  `resolveTenantSql()` defaults to `"sql-params"` too. The default is exported as `DEFAULT_TENANT_SQL_MODE`; import it rather than hard-code the mode. Studio's Playground now starts in `sql-params`, and Studio reports that default when a request names no mode.

### Patch Changes

- 47eef72: `isBuiltInDialectId()` accepts only the built-in dialect ids. It used to accept `Object.prototype` names such as `"constructor"` or `"toString"` too. So `ask()` now throws `UnknownDialectError` for such a string id, and with a tenant scope, a `DialectSpec` under such an `id` must set `tenantSqlMode`, as any other unknown dialect must.
- d82125c: The package description and README no longer call `@askdb/core` dialect-agnostic. Core owns the six built-in dialects, so `ask({ dialect: "postgres" })` needs no engine package; the README's minimal example now passes the id (ADR 0029).

## 1.0.0-beta.45

### Minor Changes

- 5bd780a: One guardrail decision point, enforced where SQL is returned and where it is rebound (ADR 0010, #310).
  
  `ask()` now runs the read-only, tenant and sensitive checks on the model's SQL before rendering it (its bound `sql` and its `sql-unbound` template, with the tenant placeholders in place), and one decision maps their findings and the configured modes to `allow`, `warn` or `deny`. `ask()` and `generateSelectSql()` results gain `verdict` (`GuardrailVerdict`: the outcome and every `GuardrailFinding`); `tenantGuardrail` and `sensitiveGuardrail` stay, derived from it. When several checks deny, every check still runs and the thrown error keeps today's precedence (`SqlValidationError`, then `TenantGuardrailError`, then `SensitiveReferenceError`), now with a `verdict` property holding every finding. A custom `AskDialect`'s reported `tenantGuardrail` becomes tenant findings (`form: "generator"`), and `passed: false` with no warnings becomes one `UNPROVABLE_SCOPE` finding. New exports: the types `GuardrailVerdict`, `GuardrailFinding`, `GuardrailOutcome`, `GuardrailCheckId`, `GuardrailForm` and `BindGuardrails`, and `expandTenantScope(policy, scope, resolveTenantDescendants)`, the `subtree` expansion `ask()` runs.
  
  **Upgrade notes (breaking):**
  
  - `bindPreparedQuery(prepared, values, guardrails)` takes a required third argument, `{ schema, tenantScope?, sensitiveGuardrailMode?, acceptWarnings? }`, and re-runs the guardrails on the template under it before binding. Without it, it throws `QueryParameterError` (`MISSING_GUARDRAIL_CONTEXT`). The result (`BoundQuery`) gains `verdict`. The default configuration (no tenant policy) only needs the new argument, `{ schema }`: a template that reads a sensitive column still binds, and the sensitive warning is reported in `verdict` on every rebind. `PreparedQuery` doesn't change, so stored templates keep working.
  - Tenant IDs move from `values` to `tenantScope`. A `:tenant_*` key in `values` throws `QueryParameterError` (`TENANT_VALUE_SUPPLIED`). The IDs are rendered the way `ask()` renders them, so a template whose predicate is `col = :tenant_<root>_ids` now rebinds (it becomes `IN (…)` with several IDs) instead of throwing `INVALID_LIST_CONTEXT`. `bindings` lists the business parameters; `unboundSql` + `params` carry the tenant IDs after the business values (interleaved in source order for `?` dialects). A placeholder the scope has no IDs for throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`), and an unexpanded `subtree` scope throws `SUBTREE_NOT_RESOLVABLE`: expand it with `expandTenantScope()` first. Tenant markers that can't be aligned throw `QueryParameterError` (`TENANT_PARAM_ALIGNMENT`).
  - With a tenant policy whose `enforcement` is `warn`, a template that fails the tenant check is refused at rebind (`TenantGuardrailError`, whose message names `acceptWarnings`) unless you pass `acceptWarnings: ["tenant"]`. Under `strict`, rebind refuses exactly what `ask()` would deny under the same scope. Policy and schema changes apply to stored templates at their next rebind.
  - A template with a `:tenant_*` placeholder can't be rebound under a `global` scope, or with a schema that has no tenant policy (`UNRESOLVED_TENANT_PLACEHOLDER`).
  - `ask()` and `resolveTenantSql()` under a `global` scope now throw `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`) when the SQL still has a `:tenant_*` placeholder, in any casing, instead of returning it unfilled with `tenantGuardrail.passed: true`. Admin SQL without a placeholder is unaffected.
  - `ask()`'s sensitive check now reads the model's SQL before tenant rendering (the same statement, with the tenant placeholder instead of its IDs), so a `strict` sensitive failure throws before tenant substitution. `generateSelectSql()` now runs every check before throwing, so its `SqlValidationError` carries the tenant findings too.
  - A placeholder written in any other form than a lowercase name (`:Status`, or `:status_nameOR` with no space before the next keyword) is now read whole and matches no declaration: `bindPreparedQuery()` throws `QueryParameterError` (`UNRESOLVED_PLACEHOLDER`) and `ask()` drops the reuse artifacts, instead of rendering part of it. A tenant placeholder in that form (`:tenant_agency_idsOR`) is never returned raw: `resolveTenantSql()` throws `TenantScopeError` (`UNRESOLVED_TENANT_PLACEHOLDER`) under every scope, and so do `ask()` and `bindPreparedQuery()` unless the tenant check denies first (a strict policy throws `TenantGuardrailError`, which doesn't count the placeholder as a filter).
  - `ask()` logs `askdb.pipeline.failed` (`phase: "generate"`) before it throws any guardrail error, as `generateSelectSql()` does. A read-only failure was logged that way before; a tenant or sensitive refusal now is too.
  - A `sensitiveGuardrailMode` other than `"off"`, `"warn"` or `"strict"` (for example `"Strict"` read from a host's config) now refuses a sensitive reference, as `"strict"` does, instead of reporting it as `allow`.
- 61f23b0: - **`loadSchema("<dir>/Schema.json")` keeps the tenant policy.** The `schema.json` file name now matches in any case. Before, on macOS and Windows (case-insensitive by default), `Schema.json` or `SCHEMA.JSON` opened the same file but loaded it as a standalone physical layer: the sibling `tenant-policy.md` was dropped, so `ask()` stopped requiring a `tenantScope`, and nothing reported an error. It now loads the enclosing directory, like `loadSchema("<dir>/schema.json")`, reading the physical layer from the path you gave.
  - **A JSON file inside a schema directory must be `schema.json`.** Any other JSON file that isn't a bundle now throws `SchemaParseError` when `tenant-policy.md`, `tables/` or `concepts.md` sits beside it, instead of loading without them. A copy such as `prod-schema.json` used to load without its tenant policy and without the `sensitive: true` marks in `tables/*.md`. Pass the directory, rename the file to `schema.json`, or pass its content to `loadSchemaFromJson()` to load only the physical layer. A JSON file with none of those files beside it still loads as a standalone physical layer. See ADR 0019.
  - **Bundle errors name the bundle.** A malformed `tenantPolicy`, `concepts` or `tables` entry in a bundle now throws `SchemaParseError` naming the file and the bundle, for example `tenant-policy.md (in /srv/prod.bundle.json)`, instead of a `tenant-policy.md` that isn't on disk. A tenant policy whose two roots map to the same placeholder now names its file too, in a bundle or a directory (`Failed to parse <file>: Invalid tenant policy: …`).
  - Docs: the core API reference and troubleshooting cover the case-insensitive `schema.json` match, the new error and bundle error names.
- e8afa01: - **SQL Server: a second statement written without `;` is rejected** (#327). T-SQL needs no `;` between statements, so `validateSelectSql` used to accept `SELECT 1 SELECT 2`, and `ask({ dialect: "sqlserver" })` could return it as checked SQL. On SQL Server it now throws `SqlValidationError` with rule `SQL_MULTI_STATEMENT` for a second `SELECT` that follows no `UNION`, `EXCEPT` or `INTERSECT` and isn't the main query after a leading `WITH`, for a parenthesized query right after a complete value (`SELECT 1 (SELECT 2)`), and for a `label:`. A subquery after a keyword, an operator, a comma, a `TOP` count or a function name still passes. Dialect ids that are no built-in engine get the same check, because their SQL must pass every engine's checks.
  - **SQL Server denies control-flow verbs.** `SQLSERVER_DIALECT.extraForbiddenKeywords` adds `begin`, `declare`, `if`, `while`, `goto`, `return`, `print`, `raiserror`, `throw`, `save`, `break`, `continue`, `open`, `close`, `deallocate`, `add` and `readtext`. They're rejected unquoted with `SQL_FORBIDDEN_KEYWORD`, and the NL→SQL prompt quotes a name that uses one.
  - **SQL Server code must be plain.** Outside strings and quoted names, a character other than printable ASCII (`\` excepted) or a Unicode letter, mark or digit (for example U+00A0, U+200B or U+FEFF), a bare money sign, a number written against a word (`1ESELECT`, `0xSELECT`), or a `?` written against a name or number throws `SQL_MULTI_STATEMENT`, because SQL Server may split tokens there differently from AskDB's lexer.
  - **The SQL Server lexer ends literals and names where SQL Server does.** `0x` with no hex digits, an exponent with no digits (`1E`), and money literals that start with a currency symbol (`$`, `$1`, `€`) are complete literals, and a name or variable continues through `@` (`a@b` is one name, so `a@b:` is a label) and ends at any character SQL Server reads as whitespace (U+00A0, U+200B, U+0085, but not U+FEFF).
  - **Upgrade notes (breaking):** SQL that passed before and now throws:
    - on SQL Server, an unquoted name that is one of the new denylist words; all but `throw` are T-SQL reserved words already, so SQL Server itself needed them quoted;
    - on SQL Server, a parenthesized subquery after a token the check doesn't list as starting an expression, such as an ODBC escape `{fn …}`;
    - on SQL Server, code outside strings and quoted names that isn't plain, as above, such as a bare `$` or a money sign other than `$`;
    - on SQL Server, a `:` written directly against anything but `(`, a comma or an operator (a name, a number, a string, a quoted name, a `)` or a symbol such as `#@`), which now counts as a label; AskDB's `:name` placeholders after `=`, `(` or `,` still pass;
    - on a dialect id that is no built-in engine: those names and shapes, plus MySQL `IF(…)`, Postgres `LATERAL (SELECT …)` and `ARRAY(SELECT …)`, and unquoted names such as `open` or `close`.
  - **Now passes on SQL Server:** a denylist word joined to a name through `@` (`a@delete`), because SQL Server reads the whole thing as one name.
  - A second statement that starts with `FETCH`, or with `END`, `GET` or `MOVE CONVERSATION`, still passes, because those words also appear in ordinary queries or as column names. Studio's runtime guard for SQL Server batches is #373.
  - Docs: Safety boundaries, Studio, Troubleshooting and the HTTP API reference describe the SQL Server check and what it still misses.

### Patch Changes

- c099a66: `suggestEnrichment()` can leave sensitive columns out of its prompt (#625, ADR 0026). `SuggestEnrichmentDeps` and `buildEnrichmentUserPrompt`'s new third argument take `omitSensitiveIdentifiersFromPrompt` (the new exported `EnrichmentPromptOptions` type); pass your `modes.omitSensitiveFromPrompt`, since core reads no config. The prompt now lists the target table with `formatSchemaV2ForNlToSql`, the formatter `ask()` uses (`TABLE public.users` with `- email text (NOT NULL) (sensitive)` lines in place of `Table:` and `email text [sensitive]`), over the table's physical fields only. With the option on, sensitive columns are withheld and a sensitive table keeps only its name. A target that is itself a sensitive column throws the new `SensitiveEnrichmentTargetError` (an `AskDbError` whose message names no column) before any model call. `ENRICHMENT_SYSTEM_PROMPT` no longer says sensitive columns are "excluded by RAG" (suggestions never use RAG): it tells the model not to suggest values for a column tagged `(sensitive)` or name one in other text, since AskDB keeps text that names a sensitive column out of its index. Unset, suggestions differ only in the line format and that rule.
- 798cc4f: **Omitting sensitive identifiers now also withholds text that names them (#374, ADR 0022).** With `omitSensitiveIdentifiersFromNlToSqlPrompt: true`, the NL→SQL prompt used to drop a sensitive column's own line but keep every description, alias, enum value and common query language block that named it, so a `customers` description of "Stores each customer's email and phone" still told the model about `email` and `phone`. Both prompt builders now withhold that text, by the schema contract's mention rule and ADR 0017's schema-wide names: `formatSchemaV2ForNlToSql` drops a table's description and each matching alias, a column's whole annotation (aliases, enum values, description) when any part names one, and the common query language block. `synthesizeRetrievedDdl` does the same for the schema text it renders, and drops the text of every retrieved chunk that names a sensitive column, checked as the prompt renders it, or carries `sensitive: true`, so an index built with `includeSensitiveDescribable: true`, an index built before beta.44, or a custom retriever can't put it back; the chunk still picks its tables. With omission off nothing changes, since the prompt lists sensitive names tagged `(sensitive)` anyway.
  
  `@askdb/core` exports `sensitiveMentionNames(schema)`, the list of names the rule checks (a column marked sensitive itself by its bare name, a column sensitive only through its table as `{ table, column }`), which `@askdb/rag`'s chunker now imports instead of keeping its own copy; its chunks don't change. `NlToSqlSchemaFormatStats` gains a required `mentionDroppedCount` (always `0` with omission off and for a v1 schema), `synthesizeRetrievedDdl` returns one too, and the `askdb.prompt.sensitive_redacted` and `askdb.pipeline.retrieval_used` log events carry it.
  
  `createMentionMatcher` now groups qualified names by table and checks each text first against a small pattern of the bare names and each table followed by its separator, running the full pattern only on a hit. Checking texts against every column of many sensitive tables then costs about as much as checking against one column per table (about 50 ms instead of 1.8 s for 90,000 texts against 900 names, on Node 22 as well as 26); its matches don't change.
  
  **Upgrade notes:** code that builds an `NlToSqlSchemaFormatStats` object by hand (a test double, say) must now set `mentionDroppedCount`; `0` keeps the old meaning.
- aa187f2: Remove the deprecated `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic` and `@askdb/connectors` packages. They are no longer published or fixed. Their last versions stay on npm (`@askdb/ai-openai`, `-azure` and `-google` 1.0.0-beta.8, `@askdb/ai-anthropic` 1.0.0-beta.6, `@askdb/connectors` 0.1.0-beta.9), so existing installs keep working.
  
  **Breaking** for code that still imports one of them. Install and import these instead:
  
  - `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`: install `@askdb/ai` and the matching AI SDK package (`@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google` or `@ai-sdk/anthropic`). `createAskDb({ config })` and `createAiRegistry()` register every built-in provider, so drop `providers: [openaiProvider]`, or pass names such as `providers: ["openai"]` to restrict the set. `openaiProvider`, `azureProvider`, `googleProvider` and `anthropicProvider` are exported from `@askdb/ai`.
  - `@askdb/connectors`: import `createConnectorRegistry`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS` and the `Connector*` types from `@askdb/introspect`, and `formatConnectionLabel`, `parseConnectionUrl` and `ConnectionLabelParts` from `@askdb/introspect/kit`. `CONNECTOR_PROVIDERS` becomes `BUILT_IN_CONNECTOR_PROVIDERS`, and `ConnectorProvider` becomes `ConnectorProviderId`.
  
  `@askdb/core`'s README no longer lists `@askdb/connectors` among the packages that need `ai` installed.

## 1.0.0-beta.44

### Minor Changes

- 9d2e2b4: **@askdb/core**: `ai` is now a **peer dependency** (`^6.0.0 || ^7.0.51`) instead of a bundled dependency, so the host application owns its AI SDK version.
  
  `ask()` takes a `LanguageModel` your app constructs, so core has to use the same `ai` instance your app does. Bundling `ai` pinned core's own copy: when `1.0.0-beta.41` moved that pin to `ai@^7`, hosts on AI SDK 6 (e.g. `ai@^6` + `@ai-sdk/openai@^3`) had to either migrate their whole AI stack or end up with two copies of `ai` whose `LanguageModel` types disagree. Both AI SDK 6 and AI SDK 7 hosts are now supported.
  
  **Migration (install-time breaking):** if you relied on `ai` arriving transitively through `@askdb/core` (or through `@askdb/postgres`, `@askdb/introspect`, `@askdb/rag`, …), add it to your own `package.json`:
  
  ```bash
  pnpm add ai            # or: npm install ai
  ```
  
  npm 7+ and pnpm (with the default `auto-install-peers`) install a missing required peer automatically, but declaring it pins the version you actually use. Yarn (classic and Berry) doesn't install peers, so Yarn users must add `ai` themselves. That includes introspection-only installs (`@askdb/introspect`, `@askdb/prisma`, the engine packages), because core loads `ai` when it is imported. No source changes are needed.
  
  Core now passes the NL→SQL and enrichment system prompts to `generateText` as `system`, which AI SDK 6 reads and AI SDK 7 still honors as a deprecated alias of `instructions`. This also fixes AI SDK 6 hosts silently losing the system prompt: AI SDK 6 ignores `instructions`.
  
  **@askdb/rag**: the optional `ai` and `@ai-sdk/openai` peers now accept AI SDK 6 as well (`ai` `^6.0.0 || ^7.0.51`, `@ai-sdk/openai` `^3.0.0 || ^4.0.29`), so AI SDK 6 hosts can install `@askdb/rag` without a peer conflict. `createAiSdkEmbedder` works with either major.
  
  **@askdb/studio**: the Playground's "Get the code" install lines now list the required peers. The `@askdb/client` snippet installs `@askdb/core` and `ai` (before, it had no `ai` at all with the AI Gateway provider), and the direct `@askdb/core` snippet installs `ai`, listed once even for the AI Gateway provider, whose SDK is `ai` itself.
  
  **@askdb/client**: the README's install line now lists `@askdb/core` and `ai`, the client's required peers, for package managers that don't install peers (Yarn).
  
  The config-driven path (`@askdb/ai` and `@askdb/client`) still requires AI SDK 7.
- 224a05b: `ask()` takes an `abortSignal` option that cancels the NL→SQL model call (`generateText({ abortSignal })`), e.g. `ask({ ..., abortSignal: AbortSignal.timeout(60_000) })`. With a built-in dialect or `DialectSpec`, an aborted call rejects with `SqlGenerationError` whose `cause` is the abort reason. A custom `AskDialect` receives the signal as `options.abortSignal` (new on `AskDialectGenerateOptions`) and maps its own errors. `generateSelectSql()`'s deps accept `abortSignal` too.
- d6e52ed: Export the `BundledSchemaV2` type: the shape of the single-file bundle that `askdb bundle` writes and `loadSchema()` / `loadSchemaFromJson()` read (`bundled`, `physical`, `tables`, `concepts?`, `tenantPolicy?`). Writers such as `@askdb/enrich`'s `bundleSchemaDirectory()` now use this type, so the bundler and the loader can't disagree about which files a bundle carries.
- ce8d837: `ask()` keeps a model's single trailing `;` in the SQL it returns instead of removing it, so `sql` is the statement the model wrote. `validateSelectSql` returns the SQL trimmed and otherwise as written, including the `;` and any whitespace before it; `unboundSql`, `preparedQuery.namedSql` and `bindPreparedQuery`'s `sql` and `unboundSql` keep the `;` of the model block they come from. The single-statement check is unchanged: any `;` other than one trailing `;` still throws `SQL_MULTI_STATEMENT`, and a dialect's `extraValidate` still runs on the statement without it.
  
  If you wrap the SQL, remove the `;` first: `SELECT * FROM (${sql}) AS q LIMIT 1000` is a syntax error on every engine when `sql` ends in `;`. The [Row limits](https://askdb.tools/guides/run-safely-in-prod/#row-limits) guide now does this with `sql.replace(/;$/, "").trimEnd()`. Studio's Playground **Execute** removes it before its row cap. `askdb ask` prints the SQL as `ask()` returned it, instead of adding a `;` of its own, which printed `;;` for a reply that ends in one.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.
- f2f6239: **Sensitive-column mentions are matched schema-wide (ADR 0017).** `@askdb/rag` now checks every table's describable text (table, column, common query language, example question, and business context) against the sensitive columns of the whole schema, not only that table's, so an `orders` note that says "match via users.ssn" is excluded by default. A column that is sensitive only because its table is, now counts only when mentioned as `table.column`, so generic names of a sensitive table (`id`, `org_id`) no longer drop unrelated concepts and tenant policy sections. To support this, `loadSchema()` and `loadSchemaFromJson()` set `sensitiveFromTable: true` on columns that are sensitive solely through their table. `@askdb/core`'s mention rule takes a qualified name as `{ table, column }` (bare names stay literal, dots included) and gains `createMentionMatcher(names)`, which compiles a name list once for checking many texts; the [schema-v2 contract](https://github.com/Ygilany/AskDB/blob/main/docs/contracts/schema-v2.md#sensitive-propagation) states the full rule. Some schemas will exclude different chunks after upgrading, which re-embeds those chunks on the next index run.

### Patch Changes

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- c610168: **CLI: `--help` / `--version` work without a config; friendly missing-config error.**
  
  - `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
  - `askdb --version` / `-V` is now supported and prints the package version.
  - When a command needs config and none exists, the CLI prints `No askdb.config.* or .config/askdb.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors (for example a config that fails to load) print their message and a hint; set `ASKDB_DEBUG=1` (or `true`) to include the stack trace. Other values, including `0`, and the `debug` package's `DEBUG` variable leave it off.
  - `askdb studio` / `askdb enrich` warn when `askdb.config.*` exists but fails to load, instead of ignoring it silently.
  
  **Docs:** the `@askdb/core` README states the pre-release beta status accurately.
- 194de19: Make the tenant placeholder helpers `resolvePlaceholders`, `replacePlaceholdersWithLiterals` and `replacePlaceholdersWithParams` module-internal. Only tests used them, and they were never part of the package entry, so no public API changes.
- cca5656: The NL→SQL prompt `ask()` sends now lists a schema, table or column whose name is one of the engine's reserved words quoted the engine's way: `TABLE billing."order"` on Postgres and CockroachDB, ``TABLE billing.`order` `` on MySQL and MariaDB, `TABLE billing.[order]` on SQL Server and `TABLE "order"` on SQLite, and the same on column lines. Models copied the bare listing and wrote `JOIN order o`, which SQLite and SQL Server refuse. Three more kinds of name are quoted the same way:
  
  - A word AskDB's own SQL checks reject unquoted (a column named `copy`, or `set` on SQL Server), which a model copying the listing would otherwise write bare and have rejected.
  - A name that isn't a plain identifier (a space, a hyphen, a leading digit). On SQL Server, whose regular identifiers take letters from Unicode 3.2 only, any name beyond ASCII letters, digits, `_` and `$`.
  - On Postgres and CockroachDB, which fold unquoted names to lowercase, a name with capitals: a Prisma table `Post` with a `createdAt` column is listed as `public."Post"` and `"createdAt"` (before, a model copying `Post` got `relation "post" does not exist`).
  
  Each engine family has its own reserved-word list, taken from its docs and checked against PostgreSQL 17, MySQL 8.4 and MariaDB 11.4 servers, set on the built-in spec as the new optional `DialectSpec.reservedWords`; a spec that spreads a built-in keeps it, and one that sets the field replaces it. The quote characters follow `id`. The full schema and the retrieved (`retriever`) schema are listed the same way. Schemas without reserved or unusual names (or, on Postgres and CockroachDB, capitals) produce the same schema block as before.
  
  Where the prompt lists tables with their schema (Postgres, CockroachDB, SQL Server, and MySQL or MariaDB with several databases), it gains one rule: when you quote a qualified name, quote each part separately (`"schema"."table"`), with the dialect's own quotes. Models quoted the whole dotted name (`` `org.program` ``), which MySQL reads as a table named `org.program` in the connection's database. The rule shows only the right form: with the wrong form added as a counter-example, `gpt-4o-mini` wrote it more often.
  
  `promptIdentifierQuoter(dialect)` is exported, and `formatSchemaV2ForNlToSql` and `synthesizeRetrievedDdl` accept it as `quoteIdentifier`; without it they list names as stored, as before. Table ids, schema artifacts, tenant policies and RAG indexes are unchanged. The tenant and sensitive-field checks already read quoted names part by part. The sensitive-field check now also catches a qualified reference to a sensitive column whose name differs only in case from another column in the same table (Postgres allows `"SSN"` and `ssn` side by side); before, the later one hid the other.
- fa2e771: Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.
- 7a0f777: **One rule for "mentions a sensitive column by name".** `@askdb/core` exports `findMentionedNames(text, names)`: a whole-word, case-insensitive match whose ends may not touch a letter, digit, or `_` of any script. `@askdb/rag`'s chunker and `@askdb/enrich`'s `findSensitiveColumnReferences` (Studio's authoring warning) both use it, so they agree on names like `ssn$` or `café`; before, enrich's `\b` boundaries missed `ssn$` and matched `caf` inside `café`. Studio keeps the details of a memory-store index in memory instead of `schema.lock.json`, which the indexer no longer writes for an ephemeral store.
- 5d3a38b: On SQLite, MySQL and MariaDB, the NL→SQL prompt `ask()` sends no longer names tables `public.<table>`. Their connectors file the database's tables under `public` to keep table ids stable across engines, and the prompt printed that label as if it were a schema, so models wrote `FROM public.agency`, which the engine refuses (`no such table: public.agency` on SQLite; MySQL reads `public` as a database name). When `public` is the schema's only namespace, its tables are now listed unqualified (`TABLE agency`), and the rule about qualifying table names tells the model never to write `public.<table>`. A MySQL database list stays qualified (`TABLE sales.orders`), including a database actually named `public`. Postgres, CockroachDB and SQL Server prompts are unchanged, and so are table ids, so committed schema artifacts, tenant policies and RAG indexes need no change.
  
  `DialectSpec` gains an optional `unqualifiedNamespace` field that drives this; the built-in SQLite, MySQL and MariaDB specs set it to the new exported `SINGLE_NAMESPACE_LABEL` (`"public"`), which the SQLite and MySQL connectors now use for their namespace too, and a spec that spreads one of them keeps it.

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

# @askdb/docs-site

## 0.0.1-beta.8

### Patch Changes

- 3191966: `createAskDb().ask()` now applies config `modes.askdbMode` (#279, ADR 0025). Before, the client ignored it: a call that named no `mode` ran core's default, `schema_only`, whatever the config said. Only the CLI and the HTTP API read the config mode, each on its own.
  
  The config mode is the loosest mode a call gets, the same rule as the `modes.omitSensitiveFromPrompt` floor. A call that names no mode runs the config mode. An unset config counts as `schema_only`. A call's `mode: "schema_only"` tightens a config of `bounded_results` for that call.
  
  The CLI and the HTTP API now pass only the caller's mode to the client, so all three surfaces resolve it the same way. A bad `--mode` still exits 1, and a bad body `mode` or `x-askdb-mode` header still returns `400`.
  
  **Upgrade notes (breaking):**
  
  - A per-call mode can no longer loosen the config. `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `mode: "bounded_results"` now run `schema_only` unless `askdb.config.*` sets `modes: { askdbMode: "bounded_results" }`. There's no error: the `askdb.pipeline.mode` log line records the mode that ran. Today's SQL output doesn't change, because `bounded_results` still produces the same SQL as `schema_only`.
  - The `askdb.run.start` log lines from the CLI and the HTTP API no longer carry a `mode` field. Read `mode` from `askdb.pipeline.mode`, which is in the same log stream.
  - `ask()` parses a call's `mode` the way it parses the config's, so `"SCHEMA-ONLY"` tightens like `"schema_only"`, and an unknown value throws `AskDbError` where it used to reach core unchecked. Typed TypeScript callers can't pass one.
  - An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are validated when they load, as before.
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
- b3624c5: The package reference drops the deprecated `@askdb/ai-*` and `@askdb/connectors` sections and adds a Removed packages table: each removed package's last version and what to install instead. The bring-your-own-model guide and `/AGENTS.md` point at it.
- c099a66: The Studio page says how the Playground and **Suggest** treat sensitive columns under `modes.omitSensitiveFromPrompt`, and what a suggestion sends the model. The core API reference documents `suggestEnrichment()`, its `omitSensitiveIdentifiersFromPrompt` option and `SensitiveEnrichmentTargetError`. The privacy model says the setting covers every prompt AskDB sends to a language model, Studio's included, and the modes concept and the production-safety guide name the tenant policy as the one exception to omission (#601, #624, #625).
- 526ad7b: The HTTP API reference documents what `createAskDbHttpServer()` returns (`{ host, port, server, listen(), close() }`, with `listen()` and `close()` returning promises), the real `port`/`host` precedence (option, then `httpApi.listen.*`, then the default), and a new "Config loading" section: the server uses the host's bootstrapped config, or loads `.env` and `askdb.config.*` from the working directory itself. The deploy guide awaits `listen()`. The config and package references list `isAskDbRuntimeInitialized()` (#280).
- 798cc4f: The privacy model, the core and client API references, the RAG guide and `/AGENTS.md` say what omitting sensitive identifiers removes: sensitive columns and any description, alias, enum value, common query language or retrieved chunk text that names one, while a sensitive table keeps a one-line placeholder with its name. The privacy model also says that a tenant policy's rules stay in the prompt, so a sensitive column they name still reaches the model. The core API reference documents `sensitiveMentionNames(schema)` and no longer says omission strips sensitive table names (#374).
- 8f906c3: The Studio page says what **Draft with AI** sends the model for a tenant policy and how it treats sensitive columns (tagged by default, left out under `modes.omitSensitiveFromPrompt`, withheld keys listed on the review screen). The multi-tenancy guide no longer says the draft starts from a plain-language description: it starts from the schema (#324).
- 86a8159: New **Upgrade AskDB** guide (`/guides/upgrading/`) lists what to change in your app for each release, newest first, starting with 1.0.0-beta.45 and 1.0.0-beta.44: breaking changes with before/after snippets, other changes you may notice, and beta.44's deprecations. The install page, the package reference and `/AGENTS.md` link to it (#628).
- 7378b80: `concepts.md` and `tenant-policy.md` saves no longer follow symbolic links (#372).
  
  - `saveConcepts()` now refuses to write when `concepts.md` is a symbolic link, with `Refusing to write concepts.md outside the schema directory: "concepts.md" is a symbolic link`. Before, a link planted at `concepts.md` (git stores symbolic links) made a save write to the file it pointed at, outside the schema directory.
  - New `saveTenantPolicy(workspace, frontmatter, body)` saves `tenant-policy.md` the same way. It first checks the policy with the core loader's rules and throws `SchemaParseError`, writing nothing, when `loadSchema()` would reject it.
  - `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` share one write path: a symbolic link at the target or at `tables/` is refused, and the content goes to a temp file renamed over the target. So `concepts.md` and `tenant-policy.md` saves are now atomic too, a hard link at either file is replaced instead of written through, and the replaced file keeps its permission bits, group and, where allowed, owner. A read-only file is still refused with `EACCES`. The schema directory itself may be a symbolic link.
  - Studio's tenant-policy save (`POST /api/tenant-policy`) calls `saveTenantPolicy()` instead of writing the file itself, so it refuses a symbolic link at `tenant-policy.md` too. A policy that wouldn't load still gets `400`.
  
  **Upgrade notes:**
  
  - A `saveConcepts()` caller whose `concepts.md` is a symbolic link now gets an error. Replace the link with a regular file in the schema directory.
  - Saving `concepts.md` or `tenant-policy.md` now needs write access to the schema directory, as saving a table already needs it for `tables/`: the temp file is created there. A writable file in a read-only schema directory now fails with `EACCES` instead of saving in place.
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

## 0.0.1-beta.7

### Patch Changes

- f506c14: - `@askdb/config`: new `isAskDbDebugEnabled()` export. It returns `true` when the `ASKDB_DEBUG` shell variable is `1` or `true` (case-insensitive), and reads `process.env` directly so binaries can use it when the config fails to load. The `askdb` CLI uses it to decide whether to print stack traces.
  - `@askdb/studio`: when `askdb.config.*` exists but fails to load, `askdb-studio` (and `askdb studio`) print `askdb-studio: warning: <path> could not be loaded, so Studio is ignoring it: <error>` and start without it, instead of starting silently. The setup wizard still never overwrites an existing config.
  - Docs: the CLI reference documents `--help`/`--version`, which commands work without a config, the missing-config message, and `ASKDB_DEBUG`; troubleshooting matches the real missing-config error and covers configs that fail to load.
- ce8d837: `ask()` keeps a model's single trailing `;` in the SQL it returns instead of removing it, so `sql` is the statement the model wrote. `validateSelectSql` returns the SQL trimmed and otherwise as written, including the `;` and any whitespace before it; `unboundSql`, `preparedQuery.namedSql` and `bindPreparedQuery`'s `sql` and `unboundSql` keep the `;` of the model block they come from. The single-statement check is unchanged: any `;` other than one trailing `;` still throws `SQL_MULTI_STATEMENT`, and a dialect's `extraValidate` still runs on the statement without it.
  
  If you wrap the SQL, remove the `;` first: `SELECT * FROM (${sql}) AS q LIMIT 1000` is a syntax error on every engine when `sql` ends in `;`. The [Row limits](https://askdb.tools/guides/run-safely-in-prod/#row-limits) guide now does this with `sql.replace(/;$/, "").trimEnd()`. Studio's Playground **Execute** removes it before its row cap. `askdb ask` prints the SQL as `ask()` returned it, instead of adding a `;` of its own, which printed `;;` for a reply that ends in one.
- d6e52ed: Document the `BundledSchemaV2` type in the core API reference, say that `askdb bundle` fails on an unreadable optional file, name the affected `askdb` versions in the multi-tenancy bundle note, and describe how default table filenames handle case-insensitive and over-long names.
- c4eddc3: Document the connection-label API in the package reference (`ConnectorConnection`, `ConnectionLabelParts`, which parser each built-in engine reads its parts with), describe Prisma-style `{…}` escaping for SQL Server, and drop `@askdb/postgres` from the HTTP service install, which no longer needs it.
- 2e75070: The package reference documents the connector registry in `@askdb/introspect` (`createConnectorRegistry`, `resolveConnection`, `connectionLabel`, open provider ids), the kit's `defineLiveConnectorProvider` and `runtimeIntrospectionString`, and marks `@askdb/connectors` deprecated.
- bc5f2c4: Document the `@askdb/introspect/kit` subpath in the package reference (driver loading, table filters, ids, row folding and connection labels), and note that `@askdb/connectors` re-exports its label helpers from the kit.

## 0.0.1-beta.6

### Patch Changes

- 5e89384: **@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) now opens by calling the check a best-effort lint, and says it is not a SQL parser and not a security boundary, with real tenant isolation coming from the database, and that `global` scope skips it. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

  **@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

  **askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.

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

## 0.0.1-beta.5

### Patch Changes

- f7b3ca0: Fix bento grid card vertical alignment. Cards in subsequent grid rows were inheriting `margin-top: 1rem` from Starlight's sibling content spacing rule, causing them to appear offset downward. Added `margin-top: 0 !important` to all grid card elements to override this and ensure proper alignment.

## 0.0.1-beta.4

### Patch Changes

- 45fef02: Pre-release documentation review: accuracy fixes verified against the code, complete reference pages, synced tabs for every install/runner permutation, and a first-time-reader editorial pass.

  **Accuracy fixes (each cross-checked against the implementation):**

  - Tenant scope examples used a nonexistent `{ kind: "single", tenantRootId, tenantId }` shape — corrected to the real API (`access.kind`: `ids` | `subtree` | `multi_root` | `global`, with stable table IDs) on the ask() options reference and the troubleshooting page.
  - Troubleshooting no longer suggests a `--config` flag (none exists); it now explains cwd-only config discovery, the supported extension order, and the `bootstrapAskDbEnv({ cwd })` equivalent for embedders.
  - Switch-engines SQLite example used `introspection.sqliteFile` — corrected to `introspection.providerConfig.sqlite.file`.
  - Quickstart's generated-config example was missing the `type AskDbConfig` import its `satisfies` clause needs; `loadSchema` is documented as synchronous.

  **Reference completeness:**

  - CLI reference: `askdb introspect` gains its undocumented flags (`--schemas`, `--exclude-schemas`, `--tables`, `--from-export`), a new "Shared logging flags" section (`-v`, `--log-level`, `--log-file`, `--log-stdout`, `--correlation-id`), `askdb ask --mock-sql`, and full docs for the `askdb-rag` binary's `index` and `query` commands.
  - HTTP API reference + deploy guide: the standalone `askdb-http` binary (`--schema-path` / `--port` / `--host`, precedence flag → config → default), the `schemaPath` server option, and `httpApi.listen` config.
  - Configuration reference: a complete top-level field map (`dialect`, `modes`, `host`, `logging`, `studio.listen`, `httpApi.listen`, `dev.mockSql`) with examples.
  - Package reference: `@askdb/client`'s typed errors and `unknownDialect` option.

  **Tabs for permutations:**

  - New `InstallTabs` component renders every install command as synced npm / pnpm / yarn tabs (`syncKey="pkg"` — one choice persists site-wide), applied across the package reference, CLI reference, and all guides.
  - Quickstart's four-command flow gains npx / pnpm dlx / yarn dlx tabs; provider and engine permutations nest install tabs inside the existing `ai-provider` / `engine` tab groups (package reference adapters, Studio driver table, switch-engines).

  **Structure and editorial:**

  - Sidebar group "Getting started" renamed to "Guides" — it holds task guides; actual onboarding pages live under "Start".
  - The embed guide now leads with the `@askdb/client` facade (matching the homepage and repo examples), with direct `ask()` as the labelled advanced path; "what to install" cards updated to match.
  - Studio page documents the new guided setup wizard, the working "Resync schema" action, and the Playground "Get the code" panel; quickstart and CLI reference point at the wizard as the no-config path.
  - First-time-reader pass: removed errata-style phrasing that only made sense against earlier drafts ("now live in…", "there is no X flag"), replaced internal jargon ("pre-v2 schemas") with plain descriptions, and fixed a broken section anchor.

- 9d78349: Add open-source community health files and docs site improvements.

  **Community health:** CODE_OF_CONDUCT.md (Contributor Covenant 2.1), `.github/PULL_REQUEST_TEMPLATE.md` with safety-boundary checklist, `.github/CODEOWNERS`. CoC linked from CONTRIBUTING.md and the issue-template chooser.

  **Docs site:** New Troubleshooting page consolidating error messages scattered across multiple pages (SQL validation codes, missing drivers, TLS, tenant scope, RAG). New `ask()` options reference page documenting every `AskPipelineOptions` field with type, default, and description. Sidebar restructured: `install.mdx` wired under Start, Guides renamed to Getting started, new pages added to navigation.

## 0.0.1-beta.3

### Patch Changes

- f4a508e: Add Cloudflare Web Analytics beacon to the docs site so page-view traffic on askdb.tools is tracked via the Cloudflare dashboard.
- 5d41d74: Add security.txt at /.well-known/security.txt to surface the vulnerability disclosure contact and policy for the askdb.tools domain.

## 0.0.1-beta.2

### Patch Changes

- 354c833: Document the `@askdb/client` facade: add it to the package reference, lead the "bring your own model", embed-in-Node, and homepage embed examples with the `createAskDb` fast path, and keep the direct `ask()` BYO path documented.

## 0.0.1-beta.1

### Patch Changes

- a78ef77: Retire the standalone install matrix from the docs navigation and move the install-by-use-case guidance into the package reference.

## 0.0.1-beta.0

### Patch Changes

- c117e41: Add implementation plans 009–013 for docs-site ease-of-understanding improvements: quickstart fast path, synced tabs for variants, Studio tour page, diagrams, and Studio-first design spike. Update plans index with execution order, dependencies, and rationale from June 12 review.

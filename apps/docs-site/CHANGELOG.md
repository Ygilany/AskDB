# @askdb/docs-site

## 0.0.1-beta.7

### Patch Changes

- f506c14: - `@askdb/config`: new `isAskDbDebugEnabled()` export. It returns `true` when the `ASKDB_DEBUG` shell variable is `1` or `true` (case-insensitive), and reads `process.env` directly so binaries can use it when the config fails to load. The `askdb` CLI uses it to decide whether to print stack traces.
  - `@askdb/studio`: when `askdb.config.*` exists but fails to load, `askdb-studio` (and `askdb studio`) print `askdb-studio: warning: <path> could not be loaded, so Studio is ignoring it: <error>` and start without it, instead of starting silently. The setup wizard still never overwrites an existing config.
  - Docs: the CLI reference documents `--help`/`--version`, which commands work without a config, the missing-config message, and `ASKDB_DEBUG`; troubleshooting matches the real missing-config error and covers configs that fail to load.

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

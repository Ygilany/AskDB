# @askdb/docs-site

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

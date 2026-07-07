---
"@askdb/docs-site": patch
---

Pre-release documentation review: accuracy fixes verified against the code, complete reference pages, synced tabs for every install/runner permutation, and a first-time-reader editorial pass.

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

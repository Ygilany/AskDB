---
"@askdb/studio": minor
"askdb": patch
---

**@askdb/studio**: Studio is now a viable front door for a brand-new project.

- **Guided setup wizard.** `askdb studio` (or `askdb-studio`) in a directory with no `askdb.config.*` or no schema artifact no longer errors out — Studio starts in setup mode and the browser walks you through it: pick a database engine and AI provider (env var *names* only — secret values stay in `.env`, which the wizard tells you to create), Studio writes `askdb.config.ts` and `.env.example`, then runs introspection server-side and opens the Overview. New endpoints: `GET /api/setup/status`, `POST /api/setup/config`, `POST /api/setup/introspect` (config write and introspection are loopback-only). Passing an explicit `--schema` that doesn't exist still fails fast.
- **"Resync schema" now works.** The Overview button (previously a no-op) re-runs introspection server-side using the connection from `askdb.config.ts` — same engine resolution as `askdb introspect` with no flags — and reloads the workspace. Enrichment markdown is preserved, exactly like the CLI path. New endpoints: `GET /api/introspect/status` (plan preview with credential-redacted source), `POST /api/introspect` (loopback-only).
- **"Get the code" panel in the Playground.** Below the generated SQL, Studio renders the exact integration snippet for the current workspace — your question, schema path, resolved dialect, configured provider, and (when enabled) the tenant scope — in two styles: config-driven `createAskDb()` from `@askdb/client`, or direct `ask()` from `@askdb/core`. Copy-paste it into a Node service and it runs against the same config Studio uses.
- `StudioWorkspaceDto` gains `dialect` and `schemaPathRelative`.

**askdb**: `askdb studio` no longer aborts when no `askdb.config.*` exists — it starts Studio in setup mode so the browser wizard can scaffold the project. All other commands still require a config.

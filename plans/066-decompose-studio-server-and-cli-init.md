# Plan 066: Decompose Studio's `server.ts` and the CLI's `init.ts`, with one shared, escaped `askdb.config.ts` renderer

> **Executor instructions**: This plan is **six ordered sub-plans (066a–066f), each its own branch and PR, each independently mergeable** in the listed order. Do one sub-plan per session unless told otherwise. Follow each step, run every verification command, and confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and report — do not improvise. When a sub-plan's PR is open, note it in the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first, before every sub-plan)** — all must hold, otherwise STOP:
>
> ```bash
> for n in 182 185 194 198; do gh pr view $n --repo Ygilany/AskDB --json number,state -q '"\(.number) \(.state)"'; done   # → all MERGED
> git grep -n "export function checkApiRequest\|export function checkHost" -- apps/studio/src/request-guard.ts   # → 2 matches (#185)
> git grep -n "export function packageManagerSpawnSpec" -- apps/studio/src/package-manager.ts                  # → 1 match (#194); after 066a it lives in packages/config/src/scaffold/
> git grep -n "function tsString" -- apps/cli/src/init.ts apps/studio/src/setup.ts        # → 2 matches before 066b, 0 after
> git grep -n "keep the two in sync" -- apps/studio/src/setup.ts                          # → 1 match before 066b (the duplication still exists)
> wc -l apps/studio/src/server.ts apps/cli/src/init.ts                                    # → roughly 2,185 and 1,114 at planning time
> ```
>
> For sub-plans after the first, also confirm the previous sub-plan's PR is merged (`gh pr list --repo Ygilany/AskDB --search "plan/066" --state all`).

## Status

- **Priority**: P3
- **Effort**: L (six S/M PRs)
- **Risk**: MED — large moves in security-relevant code (Studio request guard, config file generation that is later executed). Mitigated by "tests unchanged" as the behavior proof and by small PRs.
- **Depends on**: PRs #185 (request guard + escaped setup renderer), #194 (execute hardening, `package-manager.ts`), #198 (AI provider table used by both wizards), #182 (CLI first-run/help) merged. Soft: plan 065 (touches Studio execute — land it first or rebase onto it); plan 043 (artifact `.gitignore` — its delta recommends the helper live in the module 066a creates).
- **Category**: tech-debt
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No for the public surface of `askdb` and `@askdb/studio` (exports `createStudioServer`, `serializeWorkspace`, `runStudioCli`, `runStudioBin` unchanged). `@askdb/config` gains a new subpath export `@askdb/config/scaffold` (additive). Two deliberate bug fixes ride along and are called out in 066a/066b (Windows installs in `askdb init`; Azure/Foundry `resourceName` in Studio setup).

## Why this matters

`apps/studio/src/server.ts` is ~2,185 lines mixing HTTP plumbing, a 30-branch `if` route chain, RAG indexing, execute + driver install, playground history, AI suggestion prompts, request parsing and token accounting. `apps/cli/src/init.ts` is ~1,114 lines mixing arg parsing, an interactive wizard, config rendering, `.env.example` generation, package-manager detection and installation.

Worse, the two setup paths **duplicate security-relevant code**: both render an `askdb.config.ts` that AskDB later executes via jiti. #185 fixed a code-injection bug by routing every interpolated value through `tsString` (`JSON.stringify`) in *both* files, and `setup.ts` carries "Mirrors … keep the two in sync" comments. They have already drifted: `askdb init` writes `resourceName` for Azure/Foundry, Studio setup doesn't (so a Studio-scaffolded Azure config fails at model creation — `packages/ai/src/providers/azure.test.ts` "throws without resourceName or baseURL"); and `init.ts`'s installer spawns `pnpm.CMD`/`npm.cmd` with `shell: false`, which Node rejects on Windows since 18.20.2/20.12.2 (CVE-2024-27980), while Studio's `packageManagerSpawnSpec` handles it. One renderer and one package-manager module removes that class of drift.

## Current state

Verified on `review/integration-check @ c7404d4`. Quote-match, don't trust line numbers.

### The duplicated renderer

`apps/cli/src/init.ts`:
- `export type InitAnswers` (database, connectionEnv, sqliteFile, prismaSchema, schemaOut, aiProvider, aiKeyEnv, aiModelEnv, ragStore, pgvectorEnv, `studioExecute: { enabled; provider?; connectionEnv?; sqliteFile? }`).
- `function tsString(value: string): string { return JSON.stringify(value); }` — JSDoc: "Mirrors `tsString` in `apps/studio/src/setup.ts`."
- `renderAiSection` (emits `resourceName: env("AZURE_RESOURCE_NAME")` when `aiProvider` is `azure`/`foundry` via `azureResourceEnv`), `renderIntrospectionSection` (per-engine `switch`; **SQLite**: a value starting with `./` or `/` is emitted as a path literal, anything else as `env(<name>)`), `renderRagSection` (multi-line `storeConfig`), `renderStudioSection` (same path-vs-env heuristic for `studioExecute.sqliteFile`), `export function renderInitConfig(answers)` which wraps sections in:
  ```ts
  return `import { defineConfig, env, type AskDbConfig } from "@askdb/config";

  export default defineConfig({
  ${sections.join("\n")}
  } satisfies AskDbConfig);
  `;
  ```
- `buildEnvExample(answers)`, `collectEnvVarNames(answers)`, `const DB_URL_PLACEHOLDER`, `const DB_DRIVER_PACKAGES`, `buildInitInstallPlan`, `resolveInitDepSpecs`.
- Package-manager/project helpers, **exported and tested**: `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `type PackageManager`, `detectPackageManager` (walks up checking `pnpm-lock.yaml`, `bun.lockb`/`bun.lock`, `yarn.lock`, `package-lock.json`); private `defaultInstaller` (Windows: `cmd = win ? "pnpm.CMD" : "pnpm"` … `spawnSync(cmd, args, { cwd, stdio: "inherit", env, shell: false })`) and `formatManualInstallCommand`.
- Arg parsing `parseOptions(argv)`, `runWizard(prompter)`, `buildInquirerPrompter()`, `printNextSteps`, `runInitCli`, `optsToOverrides`, `finishInit`, `printHelp`.

`apps/studio/src/setup.ts`:
- Its own `tsString` (same body), `ENV_NAME_PATTERN`, `CONTROL_CHAR_PATTERN`, `DB_URL_PLACEHOLDER`, `DB_DRIVER_PACKAGES` ("mirrors `DB_DRIVER_PACKAGES` in `apps/cli/src/init.ts`"), `renderRagSection` ("Mirrors `renderRagSection` in `apps/cli/src/init.ts` — keep the two in sync.", inline `storeConfig: { file: {} }`).
- `export function writeSetupConfig(cwd, input: SetupConfigInput): SetupConfigResult` — validates (`validateEnvName`, `validateRelativePath`, provider allowlists, `SetupError(400, …)`), renders introspection/studio sections **inline** (SQLite file is always a validated relative path literal; no `resourceName`), writes `askdb.config.ts` + `.env.example`, then `ensureProjectDependencies`.
- Duplicated helpers: `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `detectPackageManager` (walk-up using `lockfilePackageManager`), `canResolveFrom`, `readStudioConfigPackageJson`/`resolveConfigSpec`, `runInstall` (uses `packageManagerSpawnSpec`).

`apps/studio/src/package-manager.ts` (from #194): `type PackageManager`, `lockfilePackageManager(dir)`, `packageManagerAddArgs`, `formatInstallCommand`, `type PackageManagerSpawnSpec`, `packageManagerSpawnSpec(pm, args, platform)` (validates each arg against `SAFE_ARG`, `shell: true` only on win32).

Tests that pin the escaping contract today:
- `apps/cli/src/init.test.ts` → `describe("renderInitConfig")` → `it("escapes quotes, backslashes, and newlines in interpolated values (no code injection)")` with `evaluateRenderedConfig(source)` (strips the import, evaluates with stub `defineConfig`/`env`).
- `apps/studio/src/setup.test.ts` → `describe("writeSetupConfig escaping (config code injection)")` with the same evaluator (`evaluateGeneratedConfig`) plus validation-rejection tests (`SetupError`).

### Studio `server.ts` top-level layout (by responsibility)

- Imports and `const ai = createAiRegistry();`; test seams **imported by `server.test.ts`**: `setStudioClientDirForTests`, `setStudioPgvectorStoreFactoryForTests`; public: `createStudioServer`, `serializeWorkspace` (re-exported by `apps/studio/src/index.ts`), `StudioOptions`, `StudioServer`, `MAX_JSON_BODY_BYTES`.
- `createStudioServer(options)`: builds `state: StudioState`, `sessionToken = createStudioSessionToken()`, then one handler that (in this order) runs `checkHost(req, options.host)` on every request → for `/api/*` runs `checkApiRequest(req, sessionToken)` → `GET /` (`serveIndexHtml(res, sessionToken)`), `GET /assets/*` → setup routes (`/api/setup/status`, `/api/setup/config` and `/api/setup/introspect` are loopback-only) → **setup-mode gate** (`if (state.setupReason && url.pathname.startsWith("/api/")) → 409`) → workspace/table/concepts/tenant-policy/suggest/rag/ask/history/execute routes (`/api/introspect` loopback-only) → SPA fallback `GET` non-api → 404; catch maps `StudioHttpError`/`SetupError` to their status, else 500.
- Setup/workspace handlers: `buildSetupStatus`, `handleSetupConfig`, `handleSetupIntrospect`, `handleResync`, `buildIntrospectionPlanDto`, `parseSetupConfigBody`, `serializeWorkspace`, `toRelativeSchemaPath`, `requireWorkspace`, `saveConceptsDraft`, `saveTenantPolicy`, `parseTenantPolicyBody`, `saveDraft`.
- AI: `suggestForSource`, `suggestTenantPolicyDraft` (large prompt string), `askSampleQuestion`.
- RAG (~490 lines): `getRagStatus`, `indexRag`, `queryRag`, `createCurrentStudioRagIndex`, `resolveStudioRagStoreConfig`, `openStudioRagStore`, `countStudioRagStoreChunks`, `pickFlat`, `pickEnv`, `resolveStudioRagEmbedderConfig`, `buildStudioRagEmbeddingEnv`, `fallbackStudioRagProvider`, `studioRagAiSdkKeyMissingMessage`, `createStudioRagEmbedder`, `formatStudioRagOperationError`, `findApiCallError`, `truncateForMessage`, `clearIncompatibleRagStore`, `defaultEmbeddingDimensions`, `readPositiveIntegerEnv`, `serializeRagResult`, `createStudioMockEmbedder`, `stableTokenHash`, plus types `StudioRagEmbedderConfig`, `StudioOpenRagStore` and the `studioPgvectorStoreFactoryForTests` seam.
- Playground history: `HISTORY_MAX_STORED`, `HISTORY_MAX_RETURNED`, `HISTORY_FILE_NAME`, `playgroundHistoryPath`, `readPlaygroundHistory`, `appendPlaygroundHistory`, `ensureSchemaDirGitignore`, `isProjectRootDir`, `deletePlaygroundHistoryEntry`, `HISTORY_LIMITS`, `parsePlaygroundHistoryEntry`, `requireBoundedString`, `requireBoundedJsonObject`, `isNonNegativeFinite`.
- Execute: `EXECUTE_DISABLED_MESSAGE`, `executeNotConfiguredMessage`, `getExecuteStatus`, `installExecuteDriver`, `type PackageManagerDetection`, a **third** `detectPackageManager(cwd, packageName)` (first `package.json` upward via `findProjectRoot`, lockfile only in that dir — no walk-up), `findProjectRoot`, `spawnCommand`, `executeQuery`, `sensitiveExecuteWarnings` (plan 065 renames it `checkSensitiveExecute`).
- Parsers: `parseConceptsBody`, `parseTableDraftBody`, `parseSuggestSource`, `parseAskBody`, `parseRagQuery` (plus `parseSetupConfigBody`, `parseTenantPolicyBody`, `parsePlaygroundHistoryEntry` above, and inline checks in `executeQuery`/`installExecuteDriver`).
- Usage: `createTrackedGenerateText`, `createRequestUsageCollector`, `normalizeGenerationUsage`, `sumDefined`, `sumNullable`, `readFiniteNumber`, `type StudioTokenUsageInput`, `type StudioRequestUsageCollector`.
- HTTP: `MAX_JSON_BODY_BYTES`, `bodyTooLarge`, `readJson`, `writeJson`, `writeText`, `resolveClientFile`, `serveClientFile`, `serveIndexHtml`, `contentTypeFor`, `isRecord`, `isLoopbackRequest`, `readOptionalJson`, `class StudioHttpError`.

`apps/studio/src/request-guard.ts` (#185) exports `checkHost`, `checkApiRequest`, `createStudioSessionToken`, `injectSessionToken`, `STUDIO_TOKEN_HEADER`. Its tests are `describe("request guard")` in `server.test.ts` — they are the proof the guard is intact.

### Build/packaging facts that constrain where shared code can live

- `askdb` (apps/cli) and `@askdb/studio` are compiled with plain `tsc -p tsconfig.build.json` (no bundler) and published separately. Any shared runtime module must therefore live in a **published** package both depend on. Both depend on `@askdb/config` (`"workspace:*"`); `askdb` also depends on `@askdb/studio`.
- `@askdb/config`'s `package.json` has a single `"."` export (`types`/`import`/`default`, `default` last) and deps `dotenv`, `jiti` only. `packages/core/src/package-requireability.test.ts` enforces for every published package export: `default` present and last; no top-level `await` in the exported module graph.
- `@askdb/config` must not depend on `@askdb/core` or `@askdb/ai` (it has neither today).

## Decision: the shared renderer lives in `@askdb/config/scaffold`

Create `packages/config/src/scaffold/` exposed as a new subpath export `@askdb/config/scaffold`. Justification:
1. **Must be a published package both apps depend on** (tsc, no bundler) — rules out a private workspace package or a relative import across apps.
2. **`@askdb/config` owns the `AskDbConfig` shape**, so the renderer and the type change together, and the config package's tests can prove render→load round-trips (render, write to a temp dir, load with `loadAskDbConfigProjectionSync`, compare) — the strongest possible contract for "the generated file is valid and means what we think".
3. **Node-only, no browser concerns**: consumers are the CLI and Studio's *server* (`setup.ts`); Studio's web bundle never imports it.
4. **A subpath, not the main entry**: user projects load `@askdb/config` from their `askdb.config.ts` via jiti; scaffolding code must not ride along. A subpath also signals "tooling", and keeps `index.ts` unchanged.
5. Rejected: `@askdb/studio` subpath (CLI already depends on Studio, but config generation is not Studio's concern and would invert ownership); `@askdb/enrich` (schema authoring, unrelated); duplicating with a sync test (the status quo that already drifted).

The subpath hosts: the config source renderer, the `.env.example` renderer, the engine → driver-package and URL-placeholder tables, and the package-manager/project helpers (moved from Studio's `package-manager.ts` and the two `init.ts`/`setup.ts` copies). Document it as "tooling for `askdb init` and AskDB Studio; not covered by semver stability guarantees" in its module JSDoc and in `packages/config/README.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Config tests | `pnpm --filter @askdb/config exec vitest run --config ../../vitest.config.ts` | all pass |
| CLI tests | `pnpm --filter askdb exec vitest run --config ../../vitest.config.ts` | all pass |
| Studio tests | `pnpm --filter @askdb/studio exec vitest run --config ../../vitest.config.ts` | all pass |
| Requireability | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/package-requireability.test.ts` (or its new home if plan 070 moved it) | all pass |
| Lint | `pnpm lint` | exit 0 |
| Full | `pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope** (across all sub-plans): `packages/config/src/scaffold/**` (create), `packages/config/package.json` (exports), `packages/config/README.md`, `packages/config/src/scaffold/*.test.ts` (create), `apps/cli/src/init.ts` and new `apps/cli/src/init/*.ts`, `apps/cli/src/init.test.ts`, `apps/studio/src/setup.ts`, `apps/studio/src/setup.test.ts`, `apps/studio/src/package-manager.ts` (delete in 066a), `apps/studio/src/server.ts` and new `apps/studio/src/server/*.ts`, `apps/studio/package.json` (066f only: `zod`), `.changeset/*.md`.

**Out of scope** (do NOT touch):
- `apps/studio/src/request-guard.ts` logic — only its call sites may move; order (host check → API guard → routing) must be preserved.
- `apps/studio/src/execute-registry.ts`, `introspection.ts`, the web UI (`apps/studio/src/web/**`), `apps/cli/src/cli.ts` (commander wiring), `apps/cli/src/introspect.ts`.
- Any change to HTTP status codes, response shapes, routes, CLI flags, prompts, or generated config *semantics* except the two named bug fixes.
- Adding new features (e.g. plan 043's `.gitignore` for `askdb init` — separate plan; it will reuse the module you create).

## Git workflow

- Branches: `plan/066a-config-scaffold-package-manager`, `plan/066b-shared-config-renderer`, `plan/066c-split-cli-init`, `plan/066d-studio-http-and-routes`, `plan/066e-studio-services`, `plan/066f-studio-request-schemas`.
- Conventional commits, e.g. `refactor(studio): move playground history into server/playground-history.ts`.
- One PR per sub-plan; do not merge. Pure-move commits separate from edit commits so reviewers can diff moves with `git diff --color-moved`.

## Steps

### 066a — `@askdb/config/scaffold`: package-manager and project helpers (one copy)

1. Create `packages/config/src/scaffold/package-manager.ts` by **moving** `apps/studio/src/package-manager.ts` verbatim, then add (moved from `setup.ts`/`init.ts`, one copy each): `findNearestPackageJsonDir(startDir)`, `isLikelyWorkspaceRoot(packageDir)`, `detectPackageManager(packageDir)` (walk-up over `lockfilePackageManager`, default `"npm"`). Create `packages/config/src/scaffold/index.ts` re-exporting them with a module JSDoc stating the stability note above.
2. `packages/config/package.json` `exports`: add `"./scaffold": { "types": "./dist/scaffold/index.d.ts", "import": "./dist/scaffold/index.js", "default": "./dist/scaffold/index.js" }` (`default` last). Confirm `tsconfig.build.json` emits `dist/scaffold/**`.
3. Studio: delete `apps/studio/src/package-manager.ts`; import from `@askdb/config/scaffold` in `setup.ts` and `server.ts`; delete `setup.ts`'s local `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `detectPackageManager`. Keep `server.ts`'s execute-specific `detectPackageManager(cwd, packageName)` **semantics** (no walk-up; manual reason when no lockfile) but rename it `detectExecuteDriverInstaller` and build it from `lockfilePackageManager`/`packageManagerSpawnSpec`.
4. CLI: delete `init.ts`'s `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `PackageManager`, `detectPackageManager`, `formatManualInstallCommand`; import from `@askdb/config/scaffold` and **re-export** the ones `init.test.ts` imports (`detectPackageManager`, `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`) until 066c moves those tests. Replace `defaultInstaller`'s hand-rolled Windows command with `packageManagerSpawnSpec(pm, packageManagerAddArgs(pm, packages))` and `spawnSync(spec.command, spec.args, { cwd, stdio: "inherit", env, shell: spec.shell })` — this is the Windows bug fix. `formatManualInstallCommand` → `formatInstallCommand` (identical output: `npm install --save …` / `<pm> add …`).
5. Tests: move the `isLikelyWorkspaceRoot`/`findNearestPackageJsonDir`/`detectPackageManager` cases from `init.test.ts` `describe("init helpers")` into `packages/config/src/scaffold/package-manager.test.ts` (the new owner); leave `resolveInitDepSpecs` in the CLI. Also move `describe("packageManagerSpawnSpec")` (at the end of `apps/studio/src/execute-registry.unified.test.ts`, which imports `./package-manager.js`) into the same new test file. Apply the test-audit authoring gate: this is a move, not new coverage — no new cases.
6. Changeset: `@askdb/config` minor (new subpath export), `askdb` patch ("`askdb init` installs dependencies correctly on Windows"), `@askdb/studio` patch (internal refactor; required because `apps/studio/src` changed).

**Verify**: `git grep -n "function findNearestPackageJsonDir\|function isLikelyWorkspaceRoot\|function lockfilePackageManager" -- apps packages` → exactly one match each, all under `packages/config/src/scaffold/`; `git grep -n '"pnpm.CMD"\|"npm.cmd"' -- apps/cli/src` → none; config, CLI, Studio and requireability tests pass; `pnpm build && pnpm lint` exit 0.

### 066b — one config renderer, one `.env.example` renderer

1. Create `packages/config/src/scaffold/render-config.ts` exporting:
   ```ts
   export type ScaffoldValue = { path: string } | { env: string };   // path → string literal, env → env("NAME")
   export type ScaffoldConfigInput = {
     ai: { provider: AskDbAiProviderId; apiKeyEnv: string; modelEnv?: string; resourceNameEnv?: string };
     introspection:
       | { provider: "postgres" | "mysql" | "sqlserver"; databaseUrlEnv: string; outputDir: string }
       | { provider: "sqlite"; file: ScaffoldValue; outputDir: string }
       | { provider: "prisma"; schemaPath?: string; outputDir: string };
     rag: { store: "file" | "memory" } | { store: "pgvector"; databaseUrlEnv: string };
     studioExecute?:
       | { provider: "postgres" | "mysql" | "sqlserver"; databaseUrlEnv: string }
       | { provider: "sqlite"; file: ScaffoldValue };
   };
   export function renderAskDbConfigSource(input: ScaffoldConfigInput): string;
   ```
   Rules: every interpolated string goes through a single private `tsString` (`JSON.stringify`); provider/database/store ids that become object keys or literals are re-checked against `ASKDB_AI_PROVIDERS`, `ASKDB_STUDIO_EXECUTE_PROVIDERS` and a local engine list — throw `Error` on anything else (defense in depth; callers already validate). Emit the CLI's current layout (multi-line `storeConfig`), `resourceName: env(<resourceNameEnv>)` when given, and the exact header/footer quoted in Current state. Export the tables `DB_DRIVER_PACKAGES`, `DB_URL_PLACEHOLDERS` and `renderEnvExample(entries: { name: string; value?: string; comment?: string }[], header: string[]): string` from sibling files.
2. CLI: `renderInitConfig(answers)` becomes a thin mapper `InitAnswers → ScaffoldConfigInput` (the `./`/`/` path-vs-env heuristic stays **in the CLI mapper**; `resourceNameEnv` from `azureResourceEnv`). `buildEnvExample` maps to `renderEnvExample` with byte-identical output. Delete `tsString`, `renderAiSection`, `renderIntrospectionSection`, `renderRagSection`, `renderStudioSection`, `DB_URL_PLACEHOLDER`, `DB_DRIVER_PACKAGES` from `init.ts`.
3. Studio: `writeSetupConfig` keeps all validation (`validateEnvName`, `validateRelativePath`, allowlists, `SetupError`) and maps `SetupConfigInput → ScaffoldConfigInput` (SQLite always `{ path }`). **Bug fix:** for `azure`/`foundry` pass `resourceNameEnv: "AZURE_RESOURCE_NAME"` and add that entry to the `envVars`/`.env.example` list, matching the CLI. Delete `tsString`, `renderRagSection`, inline section templates, `DB_URL_PLACEHOLDER`, `DB_DRIVER_PACKAGES` and every "mirrors … keep in sync" comment.
4. Tests (authoring gate: the renderer is now the single owner of the escaping contract):
   - `packages/config/src/scaffold/render-config.test.ts`: move the CLI's "escapes quotes, backslashes, and newlines…" case here (hostile values in every string slot, evaluated with the stub evaluator), plus one **round-trip** test: render a config for each engine via `it.each`, write it into a temp project linked with the existing `linkWorkspacePackage` helper pattern from `config.test.ts`, load it with `loadAskDbConfigProjectionSync`, and assert the flattened keys (`ASKDB_INTROSPECT_*`, `ASKDB_STUDIO_EXECUTE_PROVIDER`, …). That round-trip is new coverage justified by gate Q2: it fails if the renderer emits a shape `defineConfig`/`flattenAskDbConfig` rejects.
   - CLI `init.test.ts`: keep caller-specific mapping tests (path-vs-env heuristic, Azure resourceName, which branches appear); delete the moved escaping test.
   - Studio `setup.test.ts`: keep validation-rejection tests (Studio owns validation); reduce the two escaping cases to one that asserts `writeSetupConfig` passes hostile-but-valid paths through intact (end-to-end ownership of "validated values reach the file unmodified"); add one assertion that an `azure` setup's evaluated config has `ai.providerConfig.azure.resourceName` (regression for the bug fix — must fail on the pre-change code).
5. Behavior proof: before editing, generate the CLI output for a fixed matrix of answers (each database × each rag store × execute on/off × openai/azure) with a throwaway script and save it outside the repo; after, regenerate and `diff` — expected: **no diff** for CLI output. For Studio, compare evaluated objects (not bytes): identical except the added `resourceName` for azure/foundry. Record both results in the PR description.
6. Changeset: `@askdb/config` minor (new exports), `askdb` patch, `@askdb/studio` patch ("Studio setup writes `resourceName` for Azure/Foundry").

**Verify**: `git grep -n "function tsString\|keep the two in sync\|Mirrors \`" -- apps/cli/src apps/studio/src` → none; `git grep -n "function tsString" -- packages/config/src/scaffold` → 1; all config/CLI/Studio tests pass; `pnpm build && pnpm lint` exit 0.

### 066c — split `init.ts` along its seams

Create `apps/cli/src/init/` and move, without logic changes: `answers.ts` (`InitAnswers`, `InitAnswerOverrides`, `resolveDefaultInitAnswers`, `optsToOverrides`, `aiDefaults`, `AI_PROVIDER_SETUPS`, `VALID_AI_PROVIDERS`), `render.ts` (the 066b mapper, `buildEnvExample`, `collectEnvVarNames`), `install.ts` (`InitInstallPlan`, `buildInitInstallPlan`, `InitDepSpecs`, `resolveInitDepSpecs`, `defaultInstaller`, `InstallFn`), `options.ts` (`InitOptions`, `VALID_DATABASES`, `VALID_RAG_STORES`, `parseOptions`, `validatePath`, `printHelp`), `wizard.ts` (`InitPrompter`, `runWizard`, `buildInquirerPrompter`), and keep `init.ts` as the orchestrator (`runInitCli`, `finishInit`, `printNextSteps`) re-exporting every symbol `init.test.ts` and `cli.ts` import today (`git grep -n 'from "./init.js"' -- apps/cli/src` lists them). Then split `init.test.ts` by the same seams only if it stays green without edits other than import paths.

**Verify**: `wc -l apps/cli/src/init.ts` → under 300; `pnpm --filter askdb exec vitest run --config ../../vitest.config.ts` → same test count as before (record it first); `pnpm lint` exit 0. No changeset content change beyond a `askdb` patch "internal refactor" (the Changesets check requires one for `apps/cli/src`).

### 066d — Studio HTTP helpers and a route table

1. Move the HTTP helpers (list in Current state) into `apps/studio/src/server/http.ts`; `server.ts` keeps `export const MAX_JSON_BODY_BYTES` via re-export.
2. Replace the `if` chain with a declarative table in `apps/studio/src/server/routes.ts`:
   ```ts
   type Route = {
     method: "GET" | "POST" | "DELETE";
     match: { path: string } | { prefix: string };
     loopbackOnly?: string;          // 403 message when not loopback
     availableInSetupMode?: boolean; // default false → 409 gate applies
     handle: (ctx: RouteContext) => Promise<void> | void;
   };
   ```
   The dispatcher must preserve, in order: `checkHost` on every request; `checkApiRequest` on `/api/*`; `GET /` and `GET /assets/*`; setup routes (the only `/api/*` routes with `availableInSetupMode: true`); the 409 setup-mode gate for every other `/api/*`; first-match over the remaining table in the **same order** as today (prefix routes like `/api/tables/` and `/api/history/` stay where they are); SPA fallback for non-API `GET`; 404 `{ error: { message: "Not found" } }`; the existing catch mapping. Loopback-only routes keep their exact messages ("Setup is only available from loopback clients.", "Resync is only available from loopback clients.").
3. Add a comment block at the top of `routes.ts` stating the ordering invariants above and that the request guard runs before the table.

**Verify**: `describe("request guard")` and the whole `server.test.ts` pass **without edits**; `git grep -n 'url.pathname ===' -- apps/studio/src/server.ts` → 0 (all routes in the table); `git grep -n "checkHost(\|checkApiRequest(" -- apps/studio/src/server.ts apps/studio/src/server/` → the two calls, before dispatch. Changeset: `@askdb/studio` patch.

### 066e — Studio services

Move, one commit per module, no logic changes: `server/rag-service.ts` (RAG list + types; `setStudioPgvectorStoreFactoryForTests` stays exported from `server.ts` via re-export), `server/execute-service.ts` (execute list), `server/playground-history.ts` (history list incl. `ensureSchemaDirGitignore`), `server/usage.ts` (usage list), `server/ai-service.ts` (`suggestForSource`, `suggestTenantPolicyDraft`, `askSampleQuestion`, the `ai` registry), `server/workspace-service.ts` (setup/workspace handlers). Pass `StudioState` explicitly; no module-level state except the existing test seams. `server.ts` ends as `createStudioServer` + wiring (target < 300 lines).

**Verify**: `wc -l apps/studio/src/server.ts` → under 300; Studio tests pass unchanged; `pnpm lint` (includes `tsc -p tsconfig.web.json` and eslint) exit 0; `pnpm smoke:install` exit 0 (Studio's published `dist` layout changed). Changeset: `@askdb/studio` patch.

### 066f — request parsers → zod (optional; do last)

Add `"zod": "^4.4.3"` (same range as `packages/core/package.json`) to `apps/studio/package.json` dependencies. In `server/requests.ts` define one schema per body (`parseSetupConfigBody`, `parseConceptsBody`, `parseTableDraftBody`, `parseSuggestSource`, `parseAskBody`, `parseRagQuery`, `parsePlaygroundHistoryEntry`, execute and install-driver bodies; `parseTenantPolicyBody` already uses core's `tenantPolicyFrontmatterSchema`). **Every existing 400 message must still be produced for the same input** — before starting, run `git grep -n 'StudioHttpError(400' -- apps/studio/src > /tmp/066f-before.txt` and keep each message text via zod's custom error messages; status codes unchanged; `HISTORY_LIMITS` preserved. If preserving a message would require contortions, keep that parser hand-written and say so in the PR.

**Verify**: Studio tests pass unchanged; every message in `/tmp/066f-before.txt` still appears in `apps/studio/src/server/**`. Changeset: `@askdb/studio` patch.

## Test plan

- The behavior proof for 066a/c/d/e is **existing tests passing unchanged** (record test counts before and after each PR). Do not add tests for moved private functions.
- New tests only where ownership moves or a bug is fixed (apply the test-audit authoring gate, `.agents/skills/test-audit/SKILL.md`): the round-trip test (066b, owner `@askdb/config/scaffold`, catches renderer/loader drift), the Azure `resourceName` regression in Studio setup (066b, catches the drift that motivated this plan), and the moved package-manager tests (066a). The existing `describe("packageManagerSpawnSpec")` win32 cases (moved in 066a) already own the Windows spawn contract; do not add a CLI-level duplicate.

## Docs impact

- `packages/config/README.md`: short "`@askdb/config/scaffold` — tooling used by `askdb init` and Studio setup; not a stable API" section (066a).
- Docs site: no user-visible behavior changes except the two bug fixes, which need no page changes. Check `apps/docs-site/src/content/docs/studio.mdx` and `reference/cli.mdx` for any claim that Studio setup and `askdb init` produce different configs (`git grep -n -i "resourceName" -- apps/docs-site/src/content/docs`); fix if found. Do **not** document `@askdb/config/scaffold` on the docs site.

## Changeset guidance

Per sub-plan as listed. `@askdb/config` minor for the new subpath (pre-1.0 convention for new public surface); `askdb`/`@askdb/studio` patches. Run `pnpm changeset status` after adding each; with `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json` there should be no major bumps — if there are, STOP.

## Done criteria

- [ ] All six PRs open (or merged), each with green `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm preflight`
- [ ] `git grep -n "function tsString" -- apps packages` → one match, in `packages/config/src/scaffold/`
- [ ] `git grep -n -i "keep the two in sync\|keep in sync" -- apps/cli/src apps/studio/src` → none
- [ ] `test ! -e apps/studio/src/package-manager.ts`
- [ ] `wc -l apps/studio/src/server.ts apps/cli/src/init.ts` → each under 300
- [ ] `server.test.ts` `describe("request guard")` unchanged and passing (`git diff <base> -- apps/studio/src/server.test.ts` shows no edits in that block)
- [ ] CLI rendered-config diff for the answer matrix is empty (recorded in 066b PR)
- [ ] `@askdb/config` `exports["./scaffold"]` has `default` last; requireability test passes

## STOP conditions

- Readiness check fails, or `request-guard.ts` exports differ from `checkHost`/`checkApiRequest`/`createStudioSessionToken`/`injectSessionToken`.
- Any existing test needs a behavior edit (not just an import path) to pass after a move — that means behavior changed.
- The CLI rendered-config diff is non-empty, or Studio's evaluated configs differ in anything other than the Azure/Foundry `resourceName`.
- Adding the `./scaffold` export breaks `pnpm smoke:install` or the requireability test and the fix isn't a one-line exports/tsconfig correction.
- A route's position in the table cannot preserve today's first-match behavior (e.g. an overlapping prefix) — report the conflict.
- The package-manager consolidation would change which directory Studio's execute-driver install runs in.

## Maintenance notes

- Plan 043's follow-up (artifact `.gitignore` for `askdb init` and `introspect --out`) should add `ensureArtifactGitignore` to `@askdb/config/scaffold` and have Studio's `playground-history.ts` call it — see 043's post-review delta.
- Plan 065 adds strict sensitive-column mode to Studio execute; after 066e it lives in `server/execute-service.ts`.
- Reviewer focus: 066b (security: every string through `tsString`, ids allowlisted inside the renderer) and 066d (route order and the setup-mode gate). Use `git diff --color-moved=dimmed-zebra` for 066c/066e.
- Deferred: Studio's execute-driver installer does not walk up to a workspace-root lockfile (preserved as-is in 066a); revisit separately.

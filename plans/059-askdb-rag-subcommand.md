# Plan 059: Move `askdb-rag` into `askdb rag …` and drop `@askdb/rag`'s dependency on `@askdb/config`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report. When done, update this plan's row in `plans/README.md`, unless a reviewer dispatched you and said they maintain the index.
>
> **Readiness check (run first)**: every command must print the expected result, or STOP.
>
> ```bash
> for n in 193 198; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done   # → MERGED ×2
> grep -n "058" plans/README.md                                                         # → note 058's status (see "Depends on")
> git grep -n "@askdb/config" -- 'packages/rag/src/*.ts' ':!*.test.ts'                   # → exactly 2 files: src/bin.ts, src/cli.ts
> git grep -n '"@askdb/config"' -- packages/rag/package.json                              # → 1 match under "dependencies"
> git grep -n "PGURL/DATABASE_URL" -- packages/rag/src/cli.ts                             # → 1 match (the false claim)
> git grep -n '"@askdb/rag"' -- apps/studio/package.json                                  # → 1 match (the CLI already gets @askdb/rag transitively via @askdb/studio)
> ```

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED. It changes a shipped binary, but only for the RAG CLI's users.
- **Depends on**: #193 and #198 (merged). **Plan 058, soft**: if 058 is DONE, build the AI SDK embedder from `rt.rag.embeddingEnv` (Step 3a). If not, use Step 3b and file a follow-up to switch once 058 lands.
- **Category**: tech-debt
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: yes, minor under pre-1.0 rules. The `askdb-rag` bin becomes a stub that prints a migration message and exits 1. `askdb rag` reads `rag.*` from config where `askdb-rag` ignored it. The `--api-key` flag is removed.

## Why this matters

`@askdb/rag` is a library: chunker, indexer, stores, and a BYO embedder. Only its bundled CLI needs `@askdb/config`, but that makes config a runtime dependency of every library consumer. `@askdb/config` is the dotenv plus `askdb.config.*` loader, which a host embedding RAG doesn't want.

The CLI also ignores most of the config it loads:

- The store is always `--store`, defaulting to `file`, even when config says `pgvector`.
- There is no `rag.storeConfig` or embedder model from config.
- Embeddings are OpenAI-only through the deprecated `createOpenAiEmbedder`.
- Its error text claims it reads `PGURL/DATABASE_URL`, which it never does.

`askdb` already hosts `init`, `introspect`, `ask`, and `studio`, and already depends on `@askdb/ai` and `@askdb/config`. `askdb rag` belongs there.

## Current state

Verified on `review/integration-check @ c7404d4`.

- `packages/rag/src/bin.ts` calls `bootstrapAskDbEnv({ cwd: process.cwd() })` (which throws when no `askdb.config.*` exists), then `runRagCli(process.argv.slice(2))`. `packages/rag/bin/askdb-rag.js` is `import "../dist/bin.js";`.
- `packages/rag/package.json` has `"bin": { "askdb-rag": "./bin/askdb-rag.js" }`, `"sideEffects": ["./bin/askdb-rag.js", "./dist/bin.js"]`, and `"dependencies": { "@askdb/config": "workspace:*", "@askdb/core": "workspace:*" }`.
- `packages/rag/src/cli.ts` (499 lines) is `runRagCli`, with commands `index | query | setup-store`. What it reads from config: `runtimeConfig.rag.embedder.apiKey/baseURL` and `runtimeConfig.logging.*`. Excerpts:

```ts
function buildEmbedder(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): Embedder {
  const choice = opts.embedder ?? "mock";
  if (choice === "mock") return createMockEmbedder(embedderDimensions(opts));
  if (choice === "openai") return createOpenAiEmbedder(opts, runtimeConfig);
```

```ts
  const choice = opts.store ?? "file";
  ...
      throw new Error(
        "pgvector store requires --pg-url (or set PGURL/DATABASE_URL via your shell).",
      );
```

- `embedderId` is `mock:lexical-<dims>` or `openai:<model>[:<dims>]`. Studio uses `studio:mock-lexical-64` and `ai-sdk:<provider>:<model>:<dims>`. Studio's mock embedder (`createStudioMockEmbedder` in `apps/studio/src/server.ts`) is byte-for-byte the same algorithm as the CLI's `createMockEmbedder`.
- `packages/rag/src/cli.test.ts` (107 lines) uses `setAskDbRuntimeForTests` from `@askdb/config` and the fixture `fixtures/schemas/orders-users.schema`.
- **CLI host**: `apps/cli/src/cli.ts` dispatches sub-CLIs in `main()`:

```ts
    case "introspect":
      // `--help`, `--version`, and `templates` don't read askdb.config; everything else does.
      if (rest[0] !== "templates" && !rest.some((arg) => HELP_OR_VERSION_FLAGS.has(arg))) {
        requireAskDbConfig();
      }
      return runIntrospectCli(rest);
```

  It registers a help stub with `program.command("introspect").description(...).allowUnknownOption(true)`. `runIntrospectCli` lives in `apps/cli/src/introspect.ts`. Copy that pattern.
- **References to `askdb-rag`**:
  - `apps/docs-site/src/content/docs/reference/cli.mdx` (section "The `askdb-rag` binary", and the logging-flags sentence)
  - `guides/rag-for-large-schemas.mdx` (Path 2 plus the CI YAML)
  - `reference/packages.mdx` (the `@askdb/rag` section)
  - `docs/integration/rag-recipes.md`, `docs/specs/rag.md`, `packages/rag/README.md`
  - `packages/config/README.md` (says library packages like `@askdb/rag` read `getAskDbRuntimeConfig()`)
  - `examples/installable-smoke/run.sh` (`./node_modules/.bin/askdb-rag --version`) and its `README.md`

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install / build / lint / test | `pnpm install && pnpm build && pnpm lint && pnpm test` | exit 0 |
| CLI tests | `pnpm --filter askdb exec vitest run --config ../../vitest.config.ts src/rag.test.ts` | pass |
| pgvector suite | `pnpm pgvector:up`, then `ASKDB_PGVECTOR_URL=postgres://postgres:postgres@127.0.0.1:5434/askdb_rag pnpm --filter @askdb/rag test` | pass (see CONTRIBUTING.md "Integration Tests") |
| Docs / release | `pnpm docs:build && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**:
- `apps/cli/src/rag.ts` (create, the moved CLI), `apps/cli/src/rag.test.ts` (create, the moved tests), `apps/cli/src/cli.ts` (dispatch plus help stub), and `apps/cli/package.json` (add `"@askdb/rag": "workspace:*"`)
- `packages/rag/src/cli.ts`, `src/cli.test.ts`, `src/bin.ts` (delete), `packages/rag/bin/askdb-rag.js` (becomes a stub), `packages/rag/package.json`
- The docs and smoke files listed in "Current state"
- `.changeset/askdb-rag-subcommand.md`

**Out of scope**:
- Changes to `@askdb/rag`'s library API. `createOpenAiEmbedder` stays deprecated and exported until 1.0.
- Studio's RAG code and Studio's embedder ids.
- Unifying the mock embedder's id with Studio's. Keep `mock:lexical-<dims>` so existing mock indexes stay valid. This is a maintenance note, not in scope.
- Forwarding `askdb-rag` to `askdb rag` automatically. It was rejected; see Step 4.

## Git workflow

- Branch `plan/059-askdb-rag-subcommand`. Commit style: `feat(cli)!: askdb rag replaces the askdb-rag binary`.
- Open one PR and don't merge it.

## Steps

### Step 1: Move the code, and keep behavior identical for one commit

Move `packages/rag/src/cli.ts` to `apps/cli/src/rag.ts` and export `runRagCli(argv)`. Rewrite its imports:

- Library pieces come from `@askdb/rag` and its subpaths (`@askdb/rag/stores/pgvector`, etc.).
- `inspectLockFile` and `LockFileInspection` (in `packages/rag/src/indexer/lock-file.ts`) are **not** exported from the `@askdb/rag` barrel on c7404d4; only `readLockFile` and `writeLockFile` are. The CLI needs the `"outdated"` status that `readLockFile` collapses to `undefined`. Add both to the `export { … } from "./indexer/index.js"` block in `packages/rag/src/index.ts`, re-exporting through `indexer/index.ts`. This is an additive public export with a production caller, so mention it in the changeset.
- `getAskDbRuntimeConfig` comes from `@askdb/config`.

Also:

- Move `cli.test.ts` to `apps/cli/src/rag.test.ts`. Fix the fixture path to `../../../fixtures/schemas/orders-users.schema`, relative to `apps/cli/src`.
- Wire `case "rag":` in `main()` like `introspect`: skip `requireAskDbConfig()` for `--help`/`-h`/`--version`/`-V`/no args. Add `program.command("rag").description("Chunk, embed, and query a schema artifact for retrieval (see \`askdb rag --help\`)").allowUnknownOption(true)`.
- Replace the `readPackageVersion()` `--version` path. `askdb rag --version` should print askdb's version, so reuse `readCliVersion()`. Change the help text's `askdb-rag` to `askdb rag`.

**Verify**: `pnpm --filter askdb build && pnpm --filter askdb exec vitest run --config ../../vitest.config.ts src/rag.test.ts` → the moved tests pass unchanged, apart from the version test if there is one.

### Step 2: Read defaults from config (flags still win)

In `rag.ts`, resolve each option as flag > config > built-in default:

- **schema dir**: positional, falling back to `rt.introspection.outputDir`, the same fallback `askdb ask --schema` uses.
- **`--store`**: falls back to `rt.structured.rag.store`, then `file`.
- **`--pg-url`**: falls back to `rt.flat.ASKDB_PGVECTOR_URL`.
- **`--pg-table`**: falls back to `rt.structured.rag.storeConfig.pgvector?.table`.
- **`--file-path`**: falls back to `rt.structured.rag.storeConfig.file?.basePath`, then `<schema-dir>/schema`. Studio's `resolveStudioRagStoreConfig` uses the same rule.
- **`--dimensions`**: falls back to `rt.flat.ASKDB_RAG_EMBEDDER_DIMENSIONS`.
- **`--embedder`**: falls back to `rt.structured.rag.embedder`, then `mock`.

Replace the false error text: `pgvector store requires --pg-url, or rag.storeConfig.pgvector.databaseUrl in askdb.config.*.`

If plan 040 has landed and `rt.structured.rag` can be undefined, treat it as `{ embedder: "mock", store: "memory" }`, matching 040's default.

**Verify**: new tests (Step 5) for config-driven store and pgvector URL pass.

### Step 3: Provider-neutral embeddings via `@askdb/ai`

Replace `createOpenAiEmbedder` with `createAiRegistry()` → `createEmbeddingModel` → `createAiSdkEmbedder` from `@askdb/rag`, passing `dimensions` when explicit.

- **3a (plan 058 DONE)**: `const config = registry.resolveEmbeddingConfig(rt.rag.embeddingEnv)`. The dimensions come from `rt.rag.embedder.dimensions`, and an unknown value is an error naming `rag.embedderConfig.ai.dimensions`.
- **3b (058 not done)**: build the env as `{ ...rt.ai.aiEnv, ASKDB_AI_PROVIDER: "openai" }` for `--embedder openai`, or keep `rt.ai.aiEnv` for `ai-sdk`. Use `modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL"`. Leave a `// TODO(plan 058)` comment.

Accepted values are `--embedder mock|ai-sdk|openai`, where `openai` is an alias of `ai-sdk` with provider `openai`. `--embedder-model <id>` sets `ASKDB_AI_EMBEDDING_MODEL` in the env passed to the registry.

- **Embedder id** for AI SDK embedders: `ai-sdk:<provider>:<model>:<dims>`, Studio's format, so a CLI-built index is accepted by Studio. Mock stays `mock:lexical-<dims>`.
- **Remove `--api-key`**: secrets on the command line leak through shell history and the process list. Keys come from config/env. If it's passed, fail with: `--api-key was removed; set the key in askdb.config.* (ai.providerConfig or rag.embedderConfig).`

**Verify**: `git grep -n "createOpenAiEmbedder" apps/cli/src` → no matches.

### Step 4: Shrink `@askdb/rag` and leave a stub bin for one release

- Delete `packages/rag/src/cli.ts`, `src/cli.test.ts`, and `src/bin.ts`.
- In `package.json`, remove `@askdb/config` from `dependencies` and `"./dist/bin.js"` from `sideEffects`.
- Keep `"bin": { "askdb-rag": … }` for one release. Replace `bin/askdb-rag.js` with a dependency-free stub:

```js
#!/usr/bin/env node
// Deprecated: the RAG CLI moved into the `askdb` package. Removed before 1.0.
process.stderr.write(
  "askdb-rag has moved: use `npx askdb rag " + process.argv.slice(2).join(" ") + "`.\n" +
  "`askdb rag` reads rag.store / storeConfig / embedder from askdb.config.*; flags still override.\n",
);
process.exit(1);
```

**Decision recorded (pre-1.0)**: the stub fails loudly instead of forwarding to `askdb rag`, for two reasons.

- Forwarding would need `askdb` installed, and `@askdb/rag` can't depend on it: `askdb` → `@askdb/studio` → `@askdb/rag` would form a cycle.
- `askdb rag` now reads `rag.store` from config. Forwarding would silently switch a CI job from the `file` store to `pgvector`. A clear exit-1 message is safer.

Remove the stub and the `bin` entry at the 1.0 cutover.

**Verify**: `pnpm --filter @askdb/rag build && node packages/rag/bin/askdb-rag.js index x; echo $?` → the message, then `1`. `git grep -n "@askdb/config" packages/rag/src packages/rag/package.json` → no matches.

### Step 5: Tests (apply the test-audit authoring gate)

The owner boundary is `apps/cli/src/rag.test.ts`, calling `runRagCli` in-process with `setAskDbRuntimeForTests`. Keep the moved index/query/lock-mismatch cases. Add:

1. **Config `rag.store: "memory"` with no `--store`**: `query` fails with the memory-store message. Regression caught: config ignored again.
2. **Config `storeConfig.pgvector.databaseUrl` + `store: "pgvector"`**: the pgvector factory receives that URL. Use the existing `studioPgvectorStoreFactoryForTests`-style seam only if one exists in `@askdb/rag`. If none does, assert the error message changes when the URL is absent instead of adding a seam.
3. **An AI SDK embedder with a local HTTP embedding server**: follow `createEmbeddingServer` in `apps/studio/src/server.test.ts`. The lock records `ai-sdk:openai:text-embedding-3-small:4`. Regression caught: embedder id divergence from Studio.
4. **`--api-key`**: fails with the removal message.

Drop the moved `--version` test if it asserted `@askdb/rag`'s version.

Extend `examples/installable-smoke/run.sh`:

- Replace the `askdb-rag --version` check with `./node_modules/.bin/askdb rag --help` (exit 0).
- Add a check that `askdb-rag` exits 1 and prints `askdb rag`.
- Assert that the packed `@askdb/rag` tarball's `package.json` has no `@askdb/config` dependency.

**Verify**: `pnpm test && pnpm smoke:install` → exit 0.

### Step 6: Docs and changeset

- **`reference/cli.mdx`**: rename the section to `askdb rag`. Document the config fallbacks from Step 2, `--embedder mock|ai-sdk|openai`, the removed `--api-key`, and a one-line deprecation note for `askdb-rag`.
- **`guides/rag-for-large-schemas.mdx`**: Path 2 and the CI YAML become `npx askdb rag setup-store …`.
- **`reference/packages.mdx`**: the `@askdb/rag` section no longer ships a CLI. Point to `askdb rag`.
- **`docs/integration/rag-recipes.md`**, **`docs/specs/rag.md`**, **`packages/rag/README.md`**: update the commands.
- **`packages/config/README.md`**: drop `@askdb/rag` from the example list of library packages that read runtime config.
- **`examples/installable-smoke/README.md`** item 8.
- **Changeset**: `@askdb/rag` minor (bin replaced by a stub, `@askdb/config` dependency removed, `inspectLockFile` exported) and `askdb` minor (new `rag` command).

**Verify**:

- `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.
- `git grep -n "askdb-rag " -- apps/docs-site docs/integration docs/specs packages/rag/README.md` → matches only the deprecation note.
- `pnpm changeset status` → no `major`.

## Done criteria

- [ ] `packages/rag/package.json` has no `@askdb/config` in `dependencies`. `packages/rag/src/{cli,bin}.ts` are gone.
- [ ] `npx askdb rag --help` works without a config. `index`/`query` read `rag.*` from config.
- [ ] The `askdb-rag` stub exits 1 with the migration message. The smoke test asserts it.
- [ ] No docs page instructs `askdb-rag` except the deprecation note.
- [ ] All gates exit 0. The changeset exists.

## STOP conditions

- The moved CLI needs a `@askdb/rag` export beyond `inspectLockFile` / `LockFileInspection` (Step 1). Report the list. Don't widen the barrel further on your own.
- `pnpm smoke:install` shows `askdb`'s packed install pulling `@askdb/config` into `@askdb/rag`'s tree through a path other than `askdb` itself.
- The pgvector integration suite (`packages/rag/src/stores/pgvector.integration.test.ts`) imports anything from `cli.ts`.
- The maintainer prefers removing `askdb-rag` outright over the stub. That changes Step 4. Confirm first.

## Maintenance notes

- Follow-up: give the CLI and Studio one shared mock embedder with one id. They're already the same algorithm with two ids.
- Remove the `askdb-rag` stub and `bin` entry at the 1.0 cutover, together with plan 060's shim removals.
- If 058 landed after this plan used Step 3b, switch to `rt.rag.embeddingEnv` and delete the TODO.
- **Reviewer focus**: flag > config precedence, the embedder-id format matching Studio's, and that no secret is accepted on argv.

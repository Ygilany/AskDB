# `@askdb/config`

Prisma-style helpers for AskDB: `env()`, `defineConfig()`, plus discovery and loading of `askdb.config.*` / `.config/askdb.*` files used by first-party apps (`askdb` CLI, `@askdb/http-api`, `@askdb/studio`).

**`@askdb/config` is the single package that reads `process.env` directly** (during dotenv load, while `askdb.config.*` evaluates, and for the `ASKDB_DEBUG` diagnostics switch). All other packages obtain configuration through **`getAskDbRuntimeConfig()`**.

## Install

```bash
pnpm add @askdb/config
```

## Config file discovery

AskDB searches the working directory (`cwd`, usually `process.cwd()`) in this order:

1. `askdb.config.<ext>` — extension precedence: `ts` → `mts` → `cts` → `js` → `mjs` → `cjs` (first existing file wins).
2. `.config/askdb.<ext>` — same extension precedence.

`bootstrapAskDbEnv()`, and so the `askdb` CLI, loads every one of these extensions synchronously, `.mjs` included. The file can't use top-level `await`.

This mirrors the layout described in [Prisma's config reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference), but uses **`.config/askdb.*`** so it does not collide with Prisma's own `.config/prisma.*` files.

## Example `askdb.config.ts`

```ts
import "dotenv/config";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: {
        apiKey: env("MY_OPENAI_API_KEY"),
      },
    },
    language: {
      model: env("MY_LANGUAGE_MODEL"),
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: { databaseUrl: env("MY_DATABASE_URL") } },
    outputDir: env("MY_INTROSPECT_OUTPUT_DIR"),
  },
} satisfies AskDbConfig);
```

`defineConfig` types the object as `AskDbConfig`. A plain `export default { … }` loads too: the loader runs it through `defineConfig`, so it gets the same normalizing and checks. A config without its required `ai` or `introspection` block fails to load with an error that names the file and the block.

Your `.env` can use friendly names (`MY_OPENAI_API_KEY`, …). `defineConfig` resolves the config once: it checks each setting and fills in the defaults (language model, introspection output dir, HTTP API port and host, Studio execute limits, pgvector index strategy, etc. — see `packages/config/src/defaults.ts`). A value of the wrong type fails to load with an error that names its config key: a boolean setting must be `true` or `false`, so the string `"false"` fails. `getAskDbRuntimeConfig()` returns the resolved settings, and the **runtime flat map** maps the same settings, except the `ai` block, onto canonical environment variable names, in the same pass. The `ai` block reaches `@askdb/ai` as typed sections (`ai.language`, `ai.embedding`), never as env names. `getAskDbRuntimeConfig()` never reads a setting back from a flat map.

The `rag` block is optional. Omit it when you don't use retrieval: AskDB then uses the mock embedder and the in-memory store, as if `rag: { embedder: "mock", store: "memory", storeConfig: {} }` were set. Setting `ai.embedding` without the block is an error, since nothing would use that model.

`ai.providerConfig` holds provider connections only (one per provider, or a named list). The model choice lives in `ai.language` (the language model) and `ai.embedding` (the embedding model behind `rag.embedder: "ai"`), each with an optional `provider` and `connection`. A config that still sets a key from the older shape fails to load with an error that names each such key and its replacement; the [upgrade guide](https://askdb.tools/guides/upgrading/) shows each one before and after. See the [configuration reference](https://askdb.tools/reference/config/#the-ai-block).

## Architectural rule — `@askdb/config` is the sole `process.env` reader

**Only `@askdb/config` reads `process.env` directly.** All AskDB library packages obtain their configuration through a single typed gateway:

```ts
import { getAskDbRuntimeConfig } from "@askdb/config";

const config = getAskDbRuntimeConfig();
const store = config.rag.store;
const level = config.logging.level;
// @askdb/ai's registry takes the typed ai.language section as it is:
const model = await aiRegistry.createLanguageModelFromSection(config.ai.language);
// The embedding model, built from the ai.embedding connection only (ai.embedding is undefined unless
// rag.embedder is "ai"). It asks for ai.embedding.dimensions when that's set:
const embeddingModel = config.ai.embedding
  ? await aiRegistry.createEmbeddingModelFromSection(config.ai.embedding)
  : undefined;
```

**Rules:**

- Library packages that read AskDB settings must call `getAskDbRuntimeConfig()`, or take the runtime snapshot from their host as `@askdb/client` does, and use the returned typed fields. They must **not** call `env()`, `requiredEnv()`, or access `process.env` directly.
- `env(name)` is only for use inside `askdb.config.*` files authored by end users — it maps friendly `.env` names onto values that become part of the structured config and flat map.
- First-party app entry points call `bootstrapAskDbEnv()` at start-up. That loads dotenv, evaluates `askdb.config.*`, and installs an **in-memory runtime snapshot** (structured config + flat map). It does **not** copy AskDB settings into `process.env`.

## Migration from legacy flat config

`export default { OPENAI_API_KEY: "…" }` is **no longer supported**: a flat map has no `ai` block, so it fails to load. Use the nested shape, as a plain `export default { … }` or as `export default defineConfig({ … })` for type checking.

## API

- `getAskDbRuntimeConfig()` — **primary API for library packages**. Returns a typed `AskDbRuntimeConfig` from the bootstrapped snapshot (`structured`, the settings resolved from it, `flat`, the resolved `ai.language` and `ai.embedding` sections for `@askdb/ai`'s `*FromSection` methods (each with its provider, its connection's settings and its model; `ai.language` also has `modelFamily` and `reasoning`), `rag.store` and `rag.storeConfig` (the vector store, `"memory"` when `rag` is omitted), and `deprecations`, the config's deprecation messages).
- `env(name)` / `requiredEnv(name)` — read `process.env` while authoring `askdb.config.*` only.
- `isAskDbDebugEnabled()` — `true` when the `ASKDB_DEBUG` shell variable is `1` or `true`. Binaries use it to print stack traces; it reads `process.env` directly so it works even when the config fails to load.
- `defineConfig(config)` — returns an `AskDbEnvProjection` with `config` (structured) and `entries` (flattened canonical map).
- `bootstrapAskDbEnv(options?)` — load dotenv, load config, install the runtime snapshot.
- `isAskDbRuntimeInitialized()` — `true` once the runtime snapshot is installed. Code that may run before or after its host's bootstrap uses it to call `bootstrapAskDbEnv()` only when needed, as `@askdb/http-api`'s `createAskDbHttpServer()` does. The snapshot is process-wide: every copy of `@askdb/config` in the process sees the same one.
- `loadAskDbConfigProjection(cwd)` / `loadAskDbConfigProjectionSync(cwd)` — load projection without installing the singleton (advanced / tests).
- `discoverAskDbConfigPath(cwd)` — returns the resolved config path, if any.
- `mergeAskDbFlatIntoEnvMap(base, flat)` — merge AskDB flat entries into an env map for **child processes** (does not read `process.env` itself). Use `getAskDbRuntimeConfig().flat` as `flat` after bootstrap.
- `setAskDbRuntimeForTests(config)` / `resetAskDbRuntimeForTests()` — test helpers: install an authored `AskDbConfig` as `bootstrapAskDbEnv()` installs a loaded file, without reading the disk, and remove it.

## `@askdb/config/scaffold`

Tooling for `askdb init` and AskDB Studio's setup wizard. It is experimental, like Studio: a minor release of `@askdb/config` may change it (ADR 0030). Your own `askdb.config.ts` never needs it.

- `planAskDbScaffold(answers, versions)` — a new project's `askdb.config.ts` source, `.env.example`, the env vars the config reads, and the packages to install, from its answers (engine, connection variable or SQLite file, schema directory, `ai`, RAG store, Studio execute). Pure; it throws `AskDbScaffoldInputError`, with the answer's `field`, for an env var name that isn't uppercase POSIX (`^[A-Z_][A-Z0-9_]*$`), a control character in a path, an unknown id, or a missing answer. The caller supplies the defaults.
- `isAskDbScaffoldEnvName(name)` — the planner's env var name rule: POSIX, uppercase (`^[A-Z_][A-Z0-9_]*$`).
- `detectPackageManager(dir, env?)` — the package manager for `dir`: a lockfile in `dir` or a parent, then the nearest `package.json`'s `packageManager` or `devEngines.packageManager`, then `npm_config_user_agent`, then npm.
- `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `lockfilePackageManager`, `packageManagerAddArgs`, `supportedBuildApprovals`, `formatInstallCommand` — project and install-command helpers.
- `packageManagerSpawnSpec(pm, args, platform?)` — how to spawn the package manager: allowlisted arguments, and `shell: true` on Windows, where package managers are `.cmd` shims.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

# `@askdb/config`

Prisma-style helpers for AskDB: `env()`, `defineConfig()`, plus discovery and loading of `askdb.config.*` / `.config/askdb.*` files used by first-party apps (`askdb` CLI, `@askdb/http-api`, `@askdb/studio`).

**`@askdb/config` is the single package that reads `process.env` directly** (during dotenv load, while `askdb.config.*` evaluates, and for a tiny bootstrap-time overlay allowlist). All other packages obtain configuration through **`getAskDbRuntimeConfig()`**.

## Install

```bash
pnpm add @askdb/config
```

## Config file discovery

AskDB searches the working directory (`cwd`, usually `process.cwd()`) in this order:

1. `askdb.config.<ext>` — extension precedence: `ts` → `mts` → `cts` → `js` → `mjs` → `cjs` (first existing file wins).
2. `.config/askdb.<ext>` — same extension precedence.

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
        model: env("MY_CHAT_MODEL"),
      },
    },
  },
  database: {
    provider: "postgres",
    providerConfig: { postgres: { databaseUrl: env("MY_DATABASE_URL") } },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: {} },
    outputDir: env("MY_INTROSPECT_OUTPUT_DIR"),
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
```

Your `.env` can use friendly names (`MY_OPENAI_API_KEY`, …). `defineConfig` runs `flattenAskDbConfig`, which maps the nested object onto the canonical environment variable names used in the **runtime flat map** (and in `aiEnv` for `@askdb/ai`). **Unset optional fields get defaults inside `flattenAskDbConfig`** (chat model, introspection output dir, database URL fallbacks, RAG embedding dimensions, file-store base path, pgvector index strategy, etc. — see `packages/config/src/defaults.ts`).

## Architectural rule — `@askdb/config` is the sole `process.env` reader

**Only `@askdb/config` reads `process.env` directly.** All AskDB library packages obtain their
configuration through a single typed gateway:

```ts
import { getAskDbRuntimeConfig } from "@askdb/config";

const config = getAskDbRuntimeConfig();
const apiKey = opts.apiKey ?? config.rag.embedder.apiKey;
const level = config.logging.level;
// For @askdb/ai registry methods that accept an env-map argument:
const model = await aiRegistry.createLanguageModelFromEnv(config.ai.aiEnv, { ... });
```

**Rules:**

- Library packages (`@askdb/rag`, `@askdb/tui`, …) must call `getAskDbRuntimeConfig()` and use the returned typed fields. They must **not** call `env()`, `requiredEnv()`, or access `process.env` directly.
- `env(name)` is only for use inside `askdb.config.*` files authored by end users — it maps friendly `.env` names onto values that become part of the structured config and flat map.
- First-party app entry points call `bootstrapAskDbEnv()` at start-up. That loads dotenv, evaluates `askdb.config.*`, and installs an **in-memory runtime snapshot** (structured config + flat map + derived `aiEnv`). It does **not** copy AskDB settings into `process.env`.

## Migration from legacy flat config

`export default { OPENAI_API_KEY: "…" }` is **no longer supported**. Use nested `defineConfig({ ... satisfies AskDbConfig })` and `export default defineConfig({ … })`.

## API

- `getAskDbRuntimeConfig()` — **primary API for library packages**. Returns a typed `AskDbRuntimeConfig` from the bootstrapped snapshot (`structured`, `flat`-derived fields, and `ai.aiEnv` for `@askdb/core`).
- `env(name)` / `requiredEnv(name)` — read `process.env` while authoring `askdb.config.*` only.
- `defineConfig(config)` — returns an `AskDbEnvProjection` with `config` (structured) and `entries` (flattened canonical map).
- `flattenAskDbConfig(config)` — nested config → flat canonical map (applies defaults for optional values).
- `bootstrapAskDbEnv(options?)` / `bootstrapAskDbRuntime` — load dotenv, load config, install the runtime snapshot.
- `loadAskDbConfigProjection(cwd)` / `loadAskDbConfigProjectionSync(cwd)` — load projection without installing the singleton (advanced / tests).
- `discoverAskDbConfigPath(cwd)` — returns the resolved config path, if any.
- `mergeAskDbFlatIntoEnvMap(base, flat)` — merge AskDB flat entries into an env map for **child processes** (does not read `process.env` itself). Use `getAskDbRuntimeConfig().flat` as `flat` after bootstrap.
- `setAskDbRuntimeForTests` / `resetAskDbRuntimeForTests` — test helpers for the runtime snapshot.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

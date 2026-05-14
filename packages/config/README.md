# `@askdb/config`

Prisma-style helpers for AskDB: `env()`, `defineConfig()`, plus discovery and loading of `askdb.config.*` / `.config/askdb.*` files used by first-party apps (`@askdb/cli`, `@askdb/http-api`, `@askdb/studio`).

**`@askdb/config` is the single package that reads `process.env`.** All other packages obtain
configuration exclusively through `getAskDbRuntimeConfig()` exported from here.

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

Your `.env` can use friendly names (`MY_OPENAI_API_KEY`, …). `defineConfig` runs `flattenAskDbConfig`, which maps the nested object onto the canonical environment variable names that AskDB apps read. **Unset optional fields get defaults inside `flattenAskDbConfig`** (chat model, introspection output dir, database URL fallbacks, RAG embedding dimensions, file-store base path, pgvector index strategy, etc. — see `packages/config/src/defaults.ts`).

## Architectural rule — `@askdb/config` is the sole `process.env` reader

**Only `@askdb/config` reads `process.env` directly.** All AskDB library packages obtain their
configuration through a single typed gateway:

```ts
import { getAskDbRuntimeConfig } from "@askdb/config";

const config = getAskDbRuntimeConfig();
const apiKey = opts.apiKey ?? config.rag.embedder.apiKey;
const level   = config.logging.level;
// For @askdb/core functions that accept an env-map argument:
const model = await createAskDbLanguageModelFromEnv(config.ai.env, { ... });
```

**Rules:**
- Library packages (`@askdb/rag`, `@askdb/tui`, …) must call `getAskDbRuntimeConfig()` and use the returned typed fields. They must **not** call `env()`, `requiredEnv()`, `getAskDbRuntimeEnv()`, or access `process.env` directly.
- `env(name)` is only for use inside `askdb.config.*` files authored by end users — it maps friendly `.env` names onto the canonical keys that `bootstrapAskDbEnv()` merges.
- First-party app entry points (`@askdb/cli`, `@askdb/http-api`, `@askdb/studio`) call `bootstrapAskDbEnv()` at start-up to populate `process.env` before any library code runs. They may pass `process.env` directly to `@askdb/core` env-aware functions.

## API

- `getAskDbRuntimeConfig()` — **primary API for library packages**. Returns a typed `AskDbRuntimeConfig` object derived from the current (bootstrapped) `process.env`. Use this instead of `env()` or `getAskDbRuntimeEnv()` in any non-app, non-config-file context.
- `env(name)` — reads `process.env[name]`; returns `undefined` when missing or blank (after trim). Intended for use inside `askdb.config.*` files only.
- `requiredEnv(name)` — same read, but throws if missing or blank. Intended for use inside `askdb.config.*` files only.
- `getAskDbRuntimeEnv()` — returns `process.env`. Available for app entry points; prefer `getAskDbRuntimeConfig().ai.env` in library code.
- `defineConfig(config)` — returns a projection object whose `entries` are produced by `flattenAskDbConfig(config)` for merge into `process.env`.
- `flattenAskDbConfig(config)` — nested config → flat canonical env map (applies defaults for optional values).
- `bootstrapAskDbEnv(options?)` — loads `.env` (optional candidate paths), then merges the discovered AskDB config into `process.env`.
- `discoverAskDbConfigPath(cwd)` — returns the resolved config path, if any.
- `mergeAskDbConfigIntoEnvSync(cwd)` / `mergeAskDbConfigIntoEnv(cwd)` — merge only (dotenv already applied).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

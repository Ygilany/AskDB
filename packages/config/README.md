# `@askdb/config`

Prisma-style helpers for AskDB: `env()` and `defineConfig()`, plus discovery and loading of `askdb.config.*` / `.config/askdb.*` files used by first-party apps (`@askdb/cli`, `@askdb/http-api`, `@askdb/studio`).

## Install

```bash
pnpm add @askdb/config
```

## Config file discovery

AskDB searches the working directory (`cwd`, usually `process.cwd()`) in this order:

1. `askdb.config.<ext>` — extension precedence: `ts` → `mts` → `cts` → `js` → `mjs` → `cjs` (first existing file wins).
2. `.config/askdb.<ext>` — same extension precedence.

This mirrors the layout described in [Prisma’s config reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference), but uses **`.config/askdb.*`** so it does not collide with Prisma’s own `.config/prisma.*` files.

## Example `askdb.config.ts`

```ts
import "dotenv/config";
import { defineConfig, env } from "@askdb/config";

export default defineConfig({
  OPENAI_API_KEY: env("MY_OPENAI_API_KEY"),
  ASKDB_MODEL: env("MY_CHAT_MODEL"),
  DATABASE_URL: env("MY_DATABASE_URL"),
});
```

Your `.env` can use friendly names (`MY_OPENAI_API_KEY`, …). The config file maps them onto the canonical environment variable names that `@askdb/core` and the AskDB apps read via `process.env`.

## API

- `env(name)` — reads `process.env[name]`; throws if missing or blank (after trim).
- `optionalEnv(name, defaultValue)` — same read, but returns `defaultValue` when unset (use in repo-root templates so `askdb.config.ts` loads in CI before `.env` exists).
- `defineConfig(config)` — typing helper (returns the object unchanged).
- `bootstrapAskDbEnv(options?)` — loads `.env` (optional candidate paths), then merges the discovered AskDB config into `process.env`.
- `discoverAskDbConfigPath(cwd)` — returns the resolved config path, if any.
- `mergeAskDbConfigIntoEnvSync(cwd)` / `mergeAskDbConfigIntoEnv(cwd)` — merge only (dotenv already applied).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

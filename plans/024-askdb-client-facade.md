# Plan 024: Add a config-aware `@askdb/client` facade so `ask()` callers only pass a question

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d7faa20..HEAD -- packages/core/src/ask.ts packages/ai/src/provider.ts packages/config/src/runtime-config.ts apps/http-api/src/server.ts apps/cli/src/cli.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (purely additive — a new package; no existing file changes)
- **Depends on**: none
- **Category**: dx / tech-debt
- **Planned at**: commit `d7faa20`, 2026-06-15

## Why this matters

Today every host that calls `ask()` from `@askdb/core` must hand-wire four
things before it can ask a question: bootstrap config, build a model from the
AI registry, resolve a schema from disk/JSON, and resolve the SQL dialect. That
boilerplate is duplicated almost verbatim across `apps/cli/src/cli.ts`,
`apps/http-api/src/server.ts`, and `examples/ask-question/main.ts`, and it is
the first thing a new embedder hits. `ask()` itself is a **pure function** and
must stay that way (it is the BYO-model / multi-tenant primitive — see its doc
comment), so the fix is **not** to make core read config. Instead this plan adds
a thin config-aware facade, `@askdb/client`, that resolves schema, model, and
dialect from a runtime config + a host-provided AI registry, caches them, and
exposes `askdb.ask("question")`. `schema`, `model`, and `dialect` all become
optional overrides. This plan only **creates** the package; plan 025 migrates
the hosts onto it, plan 026 updates the example.

## Current state

The facade wraps three existing pieces. Confirm each excerpt matches before
building against it.

### `ask()` — the pure primitive the facade calls (do NOT modify it)

`packages/core/src/ask.ts:75-147` — required options today:

```ts
export type AskPipelineOptions = {
  question: string;
  schema: AnyNormalizedSchema;
  model: AskDbLanguageModel;
  /** Required: the SQL dialect. ... */
  dialect: AskDialectInput;
  explain?: boolean;
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  deps?: AskGenerateDeps;            // { generateText?: typeof defaultGenerateText }
  logger?: AskDbLogger;
  mode?: AskDbModeV1;
  retriever?: Retriever;
  retrievalK?: number;
  retrievalThresholdChunks?: number;
  totalSchemaChunkCount?: number;
  tenantScope?: TenantScope;
  tenantSqlMode?: TenantSqlOutputMode;
};
// ...
export async function ask(options: AskPipelineOptions): Promise<AskPipelineResult>
```

`@askdb/core` re-exports everything the facade needs from
`packages/core/src/index.ts`: `ask`, `AskPipelineOptions`, `AskPipelineResult`,
`AskDialectInput`, `AskGenerateDeps`, `loadSchema`, `loadSchemaFromJson`,
`AnyNormalizedSchema`, `AskDbLanguageModel`, `isBuiltInDialectId`,
`type BuiltInDialectId` (via `dialect-spec.js`), `type NormalizedSchemaV2`.

### The AI registry — how a model is built from config (`@askdb/ai`)

`packages/ai/src/provider.ts:178-208` — the `AiRegistry` type. The facade only
needs these members:

```ts
export type AiRegistry = {
  resolveAiConfig(env: AiEnv, options?: { modelDefault?: string }): AiConfig | undefined;
  createLanguageModelFromEnv(
    env: AiEnv,
    options?: { modelDefault?: string },
  ): Promise<LanguageModel | undefined>;
  keyMissingMessage(context: string): string;
  // ...other members exist; the facade does not use them
};
```

A registry is constructed by the host via `createAiRegistry([openaiProvider, ...])`.
**The facade must NOT import any `@askdb/ai-*` adapter** — the host injects the
registry. This is what preserves BYO-provider and avoids bundling every provider.

### The runtime config — where schema path / dialect / mock already live (`@askdb/config`)

`packages/config/src/runtime-config.ts:102-115` — `AskDbRuntimeConfig`. Relevant
fields the facade reads:

```ts
export type AskDbRuntimeConfig = {
  readonly structured: Readonly<AskDbConfig>;   // structured.host?.schemaPath / schemaJson, structured.dialect
  ai: { aiEnv: Record<string, string | undefined> };   // pass to registry methods
  dev: { mockSql: string | undefined };
  nlToSql: { dialect: AskDbDialectId | undefined };
  // ...
};
```

- `structured.host?.schemaPath` and `structured.host?.schemaJson` are the
  config-level schema source (`packages/config/src/types.ts`, `host?: { schemaPath?: string; schemaJson?: string }`).
- `ai.aiEnv` also carries `ASKDB_SCHEMA_PATH` / `ASKDB_SCHEMA_JSON` as the
  flattened env fallback (this is what `apps/http-api/src/server.ts:279-280`
  reads today).
- `nlToSql.dialect` is `structured.dialect`, the config dialect override.
- `dev.mockSql` drives the deterministic test path.

### The resolution logic to replicate (currently duplicated in hosts)

The facade centralizes what these two sites do today:

- **Dialect** — `apps/cli/src/cli.ts:178-203` (`resolveAskDbDialect`) and
  `apps/http-api/src/server.ts:172-179` (`resolveHttpApiDialect`). Same priority:
  `config.dialect` → `schema.provider` (when it is a built-in dialect id) →
  `"postgres"`. The CLI version additionally throws when `schema.provider` is a
  non-built-in id and emits a "note" when config and schema disagree.
- **Model** — `apps/cli/src/cli.ts:373-396` and
  `apps/http-api/src/server.ts:306-329`: when `dev.mockSql` is set, `model` is
  `undefined` (cast) and `deps.generateText` returns `{ text: mockSql }`;
  otherwise `await registry.createLanguageModelFromEnv(rt.ai.aiEnv)`.
- **Schema** — `apps/http-api/src/server.ts:270-304` (JSON override → cached
  path/json load) and `apps/cli/src/cli.ts:96-121` (`loadSchemaFromPath` +
  `resolveSchemaPathForAsk`).

### Repo conventions to match

- **Package layout exemplar**: `packages/ai-anthropic/` — copy its
  `package.json`, `tsconfig.json`, `tsconfig.build.json` shapes (read all three).
  Note `"type": "module"`, `main`/`types` → `dist`, the three scripts
  (`build` / `lint` / `test`), and `peerDependencies` + `devDependencies` both
  listing workspace deps (`"@askdb/ai": "workspace:*"` in dev, `"workspace:^"` in
  peers).
- **TS config**: `tsconfig.json` extends `../../tsconfig.base.json` with
  `rootDir: src`, `outDir: dist`; `tsconfig.build.json` extends `./tsconfig.json`
  and excludes test files.
- **Imports use `.js` extensions** on relative paths (ESM/NodeNext), e.g.
  `import { createAskDb } from "./client.js";`.
- **Tests**: Vitest, co-located `*.test.ts`. Pattern exemplar:
  `packages/ai/src/provider.test.ts` (`describe`/`it`/`expect`, `vi` for mocks).
- **Changesets**: one markdown file per change in `.changeset/`. Format:
  front-matter mapping package → semver bump, then a one-line summary. See any
  `.changeset/add-*.md`.

## Commands you will need

| Purpose             | Command                                              | Expected on success     |
|---------------------|-----------------------------------------------------|-------------------------|
| Install (re-link)   | `pnpm install`                                      | exit 0                  |
| Typecheck/lint pkg  | `pnpm --filter @askdb/client lint`                  | exit 0, no TS errors    |
| Build pkg           | `pnpm --filter @askdb/client build`                 | exit 0, emits `dist/`   |
| Test pkg            | `pnpm --filter @askdb/client test`                  | all tests pass          |
| Build deps first    | `pnpm --filter @askdb/core --filter @askdb/ai --filter @askdb/config build` | exit 0 |

## Scope

**In scope** (create these):
- `packages/client/package.json`
- `packages/client/tsconfig.json`
- `packages/client/tsconfig.build.json`
- `packages/client/README.md`
- `packages/client/src/index.ts`
- `packages/client/src/client.ts`
- `packages/client/src/client.test.ts`
- `.changeset/askdb-client-facade.md`

**Out of scope** (do NOT touch in this plan):
- `packages/core/**` — `ask()` stays pure; do not add config/fs reads to it.
- `apps/http-api/**`, `apps/cli/**`, `examples/**` — migration is plan 025/026.
- Any `@askdb/ai-*` adapter package — the facade must not import these.
- `pnpm-workspace.yaml` — `packages/*` is already globbed; no edit needed.

## Git workflow

- Branch: `advisor/024-askdb-client-facade`
- Commit per logical unit; conventional-commits style (e.g.
  `feat(client): add config-aware createAskDb facade`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scaffold the package

Create `packages/client/package.json` modeled on
`packages/ai-anthropic/package.json`:

```json
{
  "name": "@askdb/client",
  "version": "0.1.0-beta.0",
  "description": "Config-aware AskDB facade: resolves schema, model, and dialect from config so callers only pass a question.",
  "keywords": ["askdb", "nl-to-sql", "facade", "client"],
  "homepage": "https://github.com/Ygilany/AskDB#readme",
  "bugs": { "url": "https://github.com/Ygilany/AskDB/issues" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Ygilany/AskDB.git",
    "directory": "packages/client"
  },
  "license": "Apache-2.0",
  "author": "Yahya Gilany",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE", "NOTICE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "tsc -p tsconfig.build.json --noEmit",
    "test": "vitest run --config ../../vitest.config.ts"
  },
  "peerDependencies": {
    "@askdb/ai": "workspace:^",
    "@askdb/config": "workspace:^",
    "@askdb/core": "workspace:^",
    "ai": "^6.0.205"
  },
  "devDependencies": {
    "@askdb/ai": "workspace:*",
    "@askdb/config": "workspace:*",
    "@askdb/core": "workspace:*",
    "ai": "^6.0.205",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

Create `packages/client/tsconfig.json` (copy from `packages/ai/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Create `packages/client/tsconfig.build.json` (copy from
`packages/ai/tsconfig.build.json`):

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/*.integration.test.ts"]
}
```

Copy `LICENSE` and `NOTICE` from `packages/ai-anthropic/` into
`packages/client/` (the `files` array references them).

**Verify**: `pnpm install` → exit 0 and `@askdb/client` is linked
(`ls node_modules/@askdb/client` resolves, or `pnpm ls --filter @askdb/client`
shows it).

### Step 2: Implement the facade in `packages/client/src/client.ts`

Implement `createAskDb`. Target shape (adapt types until `lint` passes — do not
change behavior):

```ts
import type { AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import {
  ask,
  isBuiltInDialectId,
  loadSchema,
  loadSchemaFromJson,
  type AnyNormalizedSchema,
  type AskDbLanguageModel,
  type AskDialectInput,
  type AskGenerateDeps,
  type AskPipelineOptions,
  type AskPipelineResult,
} from "@askdb/core";
import type { BuiltInDialectId } from "@askdb/core";

/** Where a schema comes from. A pre-loaded object short-circuits loading. */
export type SchemaSource =
  | { path: string }
  | { json: string }
  | { schema: AnyNormalizedSchema };

/** Per-call options. Everything is optional; anything set overrides the client default. */
export type AskOverrides = Omit<
  AskPipelineOptions,
  "question" | "schema" | "model" | "dialect"
> & {
  schema?: SchemaSource | AnyNormalizedSchema;
  model?: AskDbLanguageModel;       // raw @ai-sdk model OR an @askdb/ai-resolved one — both are `LanguageModel`
  dialect?: AskDialectInput;
};

export type DialectResolution = {
  dialect: AskDialectInput;
  source: "override" | "config" | "schema" | "default";
  /** Set when config.dialect and schema.provider disagree (config wins). */
  note?: string;
};

export type CreateAskDbOptions = {
  /** Runtime snapshot, e.g. from `getAskDbRuntimeConfig()`. */
  config: AskDbRuntimeConfig;
  /** AI registry built from host-registered adapters via `createAiRegistry(...)`. */
  registry: AiRegistry;
  /** Default schema source. Falls back to config `host.schemaJson`/`host.schemaPath`/env. */
  schema?: SchemaSource;
  /** Default dialect override. Falls back to config.dialect → schema.provider → "postgres". */
  dialect?: BuiltInDialectId;
  /** Optional hook fired on each ask with how schema/model/dialect resolved (host logging/UX). */
  onResolve?: (info: { dialect: DialectResolution; modelSource: "override" | "registry" | "mock" }) => void;
};

export type AskDbClient = {
  ask(question: string, overrides?: AskOverrides): Promise<AskPipelineResult>;
  /** Drop cached schema + model so the next ask() re-resolves them. */
  reload(): void;
};

export function createAskDb(options: CreateAskDbOptions): AskDbClient {
  const { config, registry } = options;
  let cachedSchema: AnyNormalizedSchema | undefined;
  let cachedModel: AskDbLanguageModel | undefined;

  function loadFromSource(src: SchemaSource | AnyNormalizedSchema): AnyNormalizedSchema {
    if ("schemaId" in src) return src;            // already a NormalizedSchema(V2)
    if ("schema" in src) return src.schema;
    if ("json" in src) return loadSchemaFromJson(src.json);
    return loadSchema(src.path);
  }

  function resolveDefaultSchema(): AnyNormalizedSchema {
    if (cachedSchema) return cachedSchema;
    if (options.schema) {
      cachedSchema = loadFromSource(options.schema);
      return cachedSchema;
    }
    const host = config.structured.host;
    const env = config.ai.aiEnv;
    const json = (host?.schemaJson?.trim() || env.ASKDB_SCHEMA_JSON?.trim()) || undefined;
    if (json) {
      cachedSchema = loadSchemaFromJson(json);
      return cachedSchema;
    }
    const path = (host?.schemaPath?.trim() || env.ASKDB_SCHEMA_PATH?.trim()) || undefined;
    if (path) {
      cachedSchema = loadSchema(path);
      return cachedSchema;
    }
    throw new Error(
      "No schema configured. Pass `schema` to createAskDb() or per-call, or set host.schemaPath / host.schemaJson in askdb.config.*.",
    );
  }

  function schemaProviderOf(schema: AnyNormalizedSchema): string | undefined {
    return "provider" in schema && typeof schema.provider === "string" ? schema.provider : undefined;
  }

  function resolveDialect(schema: AnyNormalizedSchema, override?: AskDialectInput): DialectResolution {
    if (override) return { dialect: override, source: "override" };
    const configDialect = options.dialect ?? config.nlToSql.dialect;
    const provider = schemaProviderOf(schema);
    if (configDialect) {
      if (provider && provider !== configDialect) {
        return {
          dialect: configDialect,
          source: "config",
          note: `Using config dialect '${configDialect}'; schema declared provider '${provider}'.`,
        };
      }
      return { dialect: configDialect, source: "config" };
    }
    if (provider) {
      if (!isBuiltInDialectId(provider)) {
        throw new Error(
          `Schema declares provider '${provider}', but AskDB ships no DialectSpec for it. Set \`dialect\` in askdb.config.* to override.`,
        );
      }
      return { dialect: provider, source: "schema" };
    }
    return { dialect: "postgres", source: "default" };
  }

  async function resolveModel(
    override: AskDbLanguageModel | undefined,
    deps: AskGenerateDeps | undefined,
  ): Promise<{ model: AskDbLanguageModel; deps?: AskGenerateDeps; source: "override" | "registry" | "mock" }> {
    if (override) return { model: override, source: "override" };
    // Caller-supplied generateText (e.g. tests) means no model is needed.
    if (deps?.generateText) {
      return { model: undefined as unknown as AskDbLanguageModel, deps, source: "mock" };
    }
    const mockSql = config.dev.mockSql;
    if (mockSql !== undefined) {
      return {
        model: undefined as unknown as AskDbLanguageModel,
        deps: { generateText: (async () => ({ text: mockSql })) as AskGenerateDeps["generateText"] },
        source: "mock",
      };
    }
    if (cachedModel) return { model: cachedModel, source: "registry" };
    const model = await registry.createLanguageModelFromEnv(config.ai.aiEnv);
    if (!model) throw new Error(registry.keyMissingMessage("NL→SQL generation"));
    cachedModel = model;
    return { model: cachedModel, source: "registry" };
  }

  return {
    reload() {
      cachedSchema = undefined;
      cachedModel = undefined;
    },
    async ask(question, overrides = {}) {
      const { schema: schemaOverride, model: modelOverride, dialect: dialectOverride, deps, ...rest } = overrides;
      const schema = schemaOverride ? loadFromSource(schemaOverride) : resolveDefaultSchema();
      const dialect = resolveDialect(schema, dialectOverride);
      const resolvedModel = await resolveModel(modelOverride, deps);
      options.onResolve?.({ dialect, modelSource: resolvedModel.source });
      return ask({
        ...rest,
        question,
        schema,
        model: resolvedModel.model,
        dialect: dialect.dialect,
        ...(resolvedModel.deps ? { deps: resolvedModel.deps } : deps ? { deps } : {}),
      });
    },
  };
}
```

Notes for the executor:
- The `undefined as unknown as AskDbLanguageModel` casts mirror the existing host
  code (`apps/cli/src/cli.ts:376`, `apps/http-api/src/server.ts:308`) — the model
  is genuinely unused when `deps.generateText` is supplied. Keep them.
- If `AskOverrides` spreading collides with `deps` typing, resolve it by typing
  `rest` explicitly; do not change the runtime behavior described above.

**Verify**: `pnpm --filter @askdb/core --filter @askdb/ai --filter @askdb/config build`
then `pnpm --filter @askdb/client lint` → exit 0, no TS errors.

### Step 3: Re-export the public API in `packages/client/src/index.ts`

```ts
export {
  createAskDb,
  type AskDbClient,
  type CreateAskDbOptions,
  type AskOverrides,
  type SchemaSource,
  type DialectResolution,
} from "./client.js";
```

**Verify**: `pnpm --filter @askdb/client build` → exit 0 and `dist/index.js`,
`dist/index.d.ts` exist (`ls packages/client/dist`).

### Step 4: Write `packages/client/src/client.test.ts`

Model structure on `packages/ai/src/provider.test.ts`. Build a fake
`AiRegistry` (only `createLanguageModelFromEnv`, `resolveAiConfig`,
`keyMissingMessage` need real behavior; cast the rest) and a minimal
`AskDbRuntimeConfig` (cast a partial object `as unknown as AskDbRuntimeConfig`,
filling only `structured.host`, `structured.dialect`, `ai.aiEnv`, `dev.mockSql`,
`nlToSql.dialect`). Use the fixture schema dir
`fixtures/schemas/orders-users.schema` (resolve via `path` + `import.meta.url`)
for the real-load case, or pass a pre-loaded schema via `{ schema }`.

Cover these cases (one `it` each):
1. **Schema from `createAskDb({ schema: { path } })`** → `ask` receives a schema
   with the expected `schemaId`; assert via a spy on the registry / a mock
   `deps.generateText` path so no network is needed (set `dev.mockSql` so model
   resolution returns the mock and `ask` returns that SQL).
2. **Mock SQL path**: `config.dev.mockSql = "SELECT 1"` and no model override →
   `askdb.ask("q")` resolves to `{ sql: "SELECT 1" }` and the registry's
   `createLanguageModelFromEnv` is **not** called.
3. **Model override**: passing `overrides.model` (any sentinel object) and a
   `deps.generateText` returning `{ text: "SELECT 2" }` → returns `SELECT 2`
   without calling the registry.
4. **Dialect precedence**: with `dev.mockSql` set so it runs end-to-end, use the
   `onResolve` hook to capture the `DialectResolution`. Assert:
   - override wins (`overrides.dialect = "mysql"` → `source: "override"`).
   - `config.nlToSql.dialect = "mysql"` + a schema whose `provider` is
     `"postgres"` → `source: "config"`, `note` is set.
   - no config dialect + schema `provider: "postgres"` → `source: "schema"`.
   - neither set → `dialect: "postgres"`, `source: "default"`.
5. **Missing schema**: no `schema`, no `host.*`, no env → `ask` rejects with a
   message containing `No schema configured`.
6. **Missing key**: no mock, registry `createLanguageModelFromEnv` resolves
   `undefined` → rejects with the `keyMissingMessage` text.
7. **Caching**: two `ask` calls with a path-based default schema call
   `loadSchema` only once (spy via `vi.mock("@askdb/core", ...)` partial, OR
   assert the registry's `createLanguageModelFromEnv` is called once across two
   asks in the registry case). `reload()` then forces re-resolution.

**Verify**: `pnpm --filter @askdb/client test` → all pass (≥7 tests).

### Step 5: README + changeset

Write `packages/client/README.md` (short): what `createAskDb` is, the
"only pass a question" example, and the override table (`schema` / `model` /
`dialect` all optional). Show the host wiring once:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";

bootstrapAskDbEnv();
const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  registry: createAiRegistry([openaiProvider]),
});
const { sql } = await askdb.ask("top 10 customers by revenue");
```

Create `.changeset/askdb-client-facade.md`:

```md
---
"@askdb/client": minor
---

Add `@askdb/client`: a config-aware `createAskDb()` facade that resolves schema, model, and dialect from the runtime config so callers only pass a question. `schema`, `model`, and `dialect` remain optional per-call overrides. `ask()` in `@askdb/core` is unchanged and remains the pure, BYO-model primitive.
```

**Verify**: `pnpm --filter @askdb/client build && pnpm --filter @askdb/client test`
→ both exit 0.

## Test plan

- New file `packages/client/src/client.test.ts`, structured like
  `packages/ai/src/provider.test.ts`, covering the seven cases in Step 4.
- No network: every test uses either `dev.mockSql`, a `deps.generateText`
  override, or asserts on the `onResolve` hook — never a real provider.
- Verification: `pnpm --filter @askdb/client test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/client lint` exits 0 (no TS errors)
- [ ] `pnpm --filter @askdb/client build` exits 0; `packages/client/dist/index.js` and `index.d.ts` exist
- [ ] `pnpm --filter @askdb/client test` exits 0 with ≥7 passing tests
- [ ] `git status` shows changes ONLY under `packages/client/` and `.changeset/` (no edits to `packages/core`, `apps/`, `examples/`, or any `@askdb/ai-*`)
- [ ] `grep -rn "ai-openai\|ai-anthropic\|ai-azure\|ai-google" packages/client/src` returns no matches (facade does not import concrete adapters)
- [ ] `plans/README.md` status row for 024 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift since `d7faa20`).
- `AskDbRuntimeConfig`, `AiRegistry`, or `AskPipelineOptions` no longer expose
  the fields/members this plan reads (e.g. `dev.mockSql`, `nlToSql.dialect`,
  `createLanguageModelFromEnv`, `host.schemaPath`) — the resolution contract
  would be wrong.
- Making the package typecheck appears to require modifying `@askdb/core`,
  `@askdb/config`, or `@askdb/ai` — that means the boundary is different than
  assumed; report instead of editing those packages.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This package is the home for *all* host-side resolution. When a new resolution
  rule is added (e.g. a new schema source, a new dialect-inference input), it
  goes here, and plan 025 keeps the hosts thin.
- `ask()` in `@askdb/core` must stay pure — if a future change is tempted to make
  core read config, push it into this facade instead.
- The mock-SQL `generateText` shim is duplicated from the hosts intentionally so
  they can delete theirs in plan 025; if the core mock contract changes, update
  it here too.
- Reviewer should scrutinize: (a) no `@askdb/ai-*` import sneaks in; (b) the
  schema/model caches are not shared across tenants in a way that breaks
  multi-schema servers (the cache is per-client-instance — a multi-tenant host
  should create one client per tenant or always pass per-call `schema`/`model`
  overrides; note this in the README).

# Plan 008: Docs-site accuracy sweep — config example, dialect story, RAG API, CLI flags, config reference

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0f0c481..HEAD -- apps/docs-site/src/content/docs/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch in an excerpt you are about to edit, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (docs-only; no source code changes)
- **Depends on**: none (independent of plan 007; both may touch `plans/README.md` — run sequentially, 007 first)
- **Category**: docs
- **Planned at**: commit `0f0c481`, 2026-06-12

## Why this matters

A docs review (2026-06-12) verified every docs-site page against the shipped
code and found a set of statements that are simply false: a quickstart config
example that doesn't typecheck, a CLI flag that doesn't exist, a claim that
the CLI sniffs the SQL dialect from connection-string URL schemes (it
doesn't), a claim that installing `@askdb/postgres` "enables" the dialect
(all dialects ship inside `@askdb/core`), a RAG indexing example built on a
function (`indexSchema`) that was never exported, an env var
(`ASKDB_PRISMA_SCHEMA`) that doesn't exist, and a config-discovery/precedence
description that contradicts `@askdb/config`. Each one fails exactly the
users who copy-paste from the docs. This plan corrects all of them in one
pass.

## Current state — verified facts about the code (do not re-derive)

These facts were verified at commit `0f0c481`. The docs edits below must
agree with them.

1. **`askdb ask --schema` is optional.** `apps/cli/src/cli.ts:268-273`
   defines it as `.option("-s, --schema <path>", "… (default: configured
   introspection.outputDir, or ./askdb/)")`. `--question` is the only
   required option. There is **no `--dialect` flag**. There IS an
   `--explain` flag.
2. **Dialect resolution for `askdb ask`** (`apps/cli/src/cli.ts:172-197`,
   `resolveAskDbDialect`): `dialect` from `askdb.config.ts` → the `provider`
   recorded in the schema artifact's `schema.json` → default `"postgres"`.
   Nothing parses connection-string schemes.
3. **The schema artifact records its provider at introspection time.** Live
   connectors record their engine; the Prisma connector reads
   `datasource.provider` from the `.prisma` file and maps it via
   `mapPrismaProviderToDialectId` (`packages/prisma/src/prisma.ts:183-196`):
   `postgresql→postgres`, `mysql→mysql`, `sqlite→sqlite`,
   `sqlserver→sqlserver`, `cockroachdb→cockroachdb`. So a Prisma-introspected
   artifact still tells `ask` its dialect — that's the answer to "how does
   Prisma know the dialect".
4. **Introspection engine choice**: `--engine` flag → `introspection.provider`
   from config → default `postgres` (`apps/cli/src/introspect.ts:113`,
   `resolveEngine` at `:362`). No URL sniffing.
5. **All four dialect specs ship in `@askdb/core`**
   (`packages/core/src/sql/dialect-spec.ts` — `POSTGRES_DIALECT`,
   `MYSQL_DIALECT`, `SQLITE_DIALECT`, `SQLSERVER_DIALECT`, registry at
   `:118-128`). Engine packages (`@askdb/postgres` etc.) are **introspection
   connectors** that also re-export the core dialect constants
   (`packages/postgres/src/index.ts:5` — "Dialect re-export"). `ask()` works
   with `@askdb/core` alone; you install an engine package to run
   `askdb introspect` against that engine programmatically or to get its
   catalog templates.
6. **The real RAG indexing API** (`packages/rag/src/index.ts`,
   `packages/rag/src/indexer/index.ts:62`): `buildSchemaIndex(options)`
   where options include `schema` (a `loadChunkerSourcesFromDir(dir)` result
   or a `loadSchema(...)` result), `embedder`, `store`, optional
   `embedderId`, `lockFilePath`, `batchSize`. It returns
   `{ retriever, stats, chunks }`. There is **no `indexSchema`**. Embedders
   are built with `createAiSdkEmbedder({ model })` (any AI SDK embedding
   model, `packages/rag/src/embedders/ai-sdk.ts:39`) or
   `createOpenAiEmbedder(...)`. `createRetriever({ store, embedder })`
   exists as documented (`indexer/index.ts:289`).
7. **No `ASKDB_PRISMA_SCHEMA` env var exists** (repo-wide grep: zero hits).
   The Prisma schema path comes from
   `introspection.providerConfig.prisma.schemaPath` in `askdb.config.ts`
   (no flat env key — `packages/config/src/flatten.ts:152-154`), with
   auto-discovery of `prisma/schema.prisma` or `schema.prisma` when unset.
8. **Config discovery** (`packages/config/src/discover.ts`): two families in
   order — `askdb.config.<ext>` in cwd, then `.config/askdb.<ext>` in cwd —
   each trying extensions `ts → mts → cts → js → mjs → cjs`. **No `.json`
   support and no upward directory walk**; `bootstrapAskDbEnv` errors if
   nothing is found under cwd (`packages/config/src/bootstrap.ts:83-89`).
9. **Runtime snapshot fields** (`packages/config/src/runtime-config.ts:105-113`):
   `ai`, `introspection`, `rag`, `logging`, `httpApi`, `dev`, `modes`,
   `nlToSql`, `studio`. There is **no `rt.schema`**; the introspection group
   has `outputDir`, `provider`, per-engine URLs (`runtime-config.ts:42-72`).
10. **Precedence** (`packages/config/src/bootstrap.ts:90-94`): the runtime
    snapshot is built **only** from the config file's projection —
    `process.env` is not merged on top afterwards. Env vars matter because
    `env("VAR")` inside the config reads them at load time (`.env` is loaded
    first via dotenv, which does *not* overwrite already-set system env
    vars). Per-command CLI flags / per-call `ask()` arguments override
    snapshot values.
11. **The real `askdb init` template** (`apps/cli/src/init.ts:17-87`) uses
    `ai.providerConfig.openai.{apiKey, model}` — there is no flat
    `ai.model`/`ai.apiKey`. `AskDbConfig` (`packages/config/src/types.ts:255`)
    requires `ai`, `introspection`, and `rag` at the top level;
    `introspection.provider` is required in every branch.
12. **CLI-registered AI providers** (`apps/cli/src/cli.ts:36`): `openai`,
    `azure`, `google`, `anthropic` (+ `foundry` via config). OpenRouter is
    not a registered provider — it is reachable as an OpenAI-compatible
    endpoint via a custom `baseUrl`.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Install (only if `node_modules` missing) | `pnpm install` | exit 0 |
| Docs typecheck | `pnpm --filter docs-site lint` | exit 0 (astro check) |
| Docs build + base-path link check | `pnpm --filter docs-site test` | exit 0 |

## Scope

**In scope** (the only files you may modify, plus the index):
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/src/content/docs/guides/switch-engines.mdx`
- `apps/docs-site/src/content/docs/concepts/modes-and-dialects.mdx`
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx`
- `apps/docs-site/src/content/docs/reference/cli.mdx`
- `apps/docs-site/src/content/docs/guides/rag-for-large-schemas.mdx`
- `apps/docs-site/src/content/docs/guides/integrations/prisma.mdx`
- `apps/docs-site/src/content/docs/reference/config.mdx`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `guides/multi-tenancy.mdx` — owned by plan 007.
- `index.mdx` — has a pre-existing uncommitted fix (MIT → Apache 2.0); leave
  the working-tree change alone.
- All source code under `apps/cli`, `packages/**` — if a docs claim can only
  be made true by changing code, that's a STOP condition, not a code edit.
- `install.mdx` — its provider list (line 13) already says "or any
  OpenAI-compatible endpoint" and is acceptable; leaving it avoids scope
  creep. (Optional follow-up noted in Maintenance.)

## Git workflow

- Work on the current branch `Ygilany/fix-docs-review-items`.
- One commit for the whole sweep is fine; message style (from `git log`):
  `docs(site): fix config example, dialect story, RAG API, and reference accuracy`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `quickstart.mdx` — provider list, config example, dialect claim

File: `apps/docs-site/src/content/docs/quickstart.mdx`

**1a.** Line 14 currently reads:

> - An API key from a model provider — OpenAI, Anthropic, Google, OpenRouter, or any AI-SDK compatible provider. See [Bring your own model](/guides/bring-your-own-model/).

Replace with:

> - An API key from a model provider — OpenAI, Anthropic, Google, Azure, or any OpenAI-compatible endpoint (OpenRouter, vLLM, Ollama, …). See [Bring your own model](/guides/bring-your-own-model/).

**1b.** Lines 37-49 currently show a config that doesn't typecheck (flat
`ai.model`, no `providerConfig`, no `introspection.provider`):

```ts
export default defineConfig({
  ai: {
    provider: "openai",   // "openai" | "azure" | "foundry" | "google" | "anthropic" — or a custom string (see /reference/config/)
    model: "gpt-4o-mini",
  },
  introspection: {
    outputDir: "./my-app.schema",  // optional — defaults to ./askdb/
  },
});
```

Replace the code block with (keep the surrounding prose sentence "Open
`askdb.config.ts` and fill in your settings:"):

````markdown
```ts
import { defineConfig, env } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",   // "openai" | "azure" | "foundry" | "google" | "anthropic" — or a custom string
    providerConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),   // optional — defaults to gpt-4o-mini
      },
    },
  },
  introspection: {
    provider: "postgres",            // "postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"
    providerConfig: {
      postgres: { databaseUrl: env("DATABASE_URL") },
    },
    outputDir: "./my-app.schema",    // optional — defaults to ./askdb/
  },
  // ... the scaffolded file also includes `rag`, `logging`, `studio`, and
  // `httpApi` sections — keep them as generated. Every option is documented
  // in the Configuration reference.
});
```

The snippet above is the part you'll actually edit; the scaffolded template
contains the full config. See the [Configuration reference](/reference/config/)
for every option.
````

**1c.** Line 82 first sentence currently reads:

> AskDB picks the right dialect from the connection string.

Replace that sentence with:

> The engine comes from `introspection.provider` in your config (or the
> `--engine` flag — see below); the introspected artifact records it, and
> `askdb ask` later infers the SQL dialect from the artifact.

Keep the rest of the paragraph (the links to the Configuration reference and
Switch engines) unchanged.

**Verify**: `grep -n "picks the right dialect\|model: \"gpt-4o-mini\"\|OpenRouter, or any AI-SDK" apps/docs-site/src/content/docs/quickstart.mdx` → no matches.

### Step 2: `guides/switch-engines.mdx` — URL sniffing, "enables the dialect", Prisma note

File: `apps/docs-site/src/content/docs/guides/switch-engines.mdx`

**2a.** In the Step-2 example (lines 48-53), the command lacks `--engine`.
Replace the code block:

```bash
npx askdb introspect \
  --url "mysql://user:pass@host/dbname" \
  --out my-app.schema \
  --schema-id my-app
```

with:

```bash
npx askdb introspect \
  --engine mysql \
  --url "mysql://user:pass@host/dbname" \
  --out my-app.schema \
  --schema-id my-app
```

**2b.** Line 55 currently reads:

> The connection string format follows each engine's convention. The CLI picks the right dialect from the URL scheme.

Replace with:

> The connection string format follows each engine's convention. The engine
> itself comes from `--engine` (or `introspection.provider` in
> `askdb.config.ts`) — the CLI does not infer it from the URL. The artifact
> records which engine produced it, and `askdb ask` infers the dialect from
> the artifact.

**2c.** Line 74 currently reads:

> The dialect adapter packages (`@askdb/mysql`, `@askdb/postgres`, etc.) define the SQL generation rules, parameter syntax, and validator for each engine. Installing the right package is what *enables* the dialect — `ask()` still needs to know which one to activate, which is what this parameter does.

Replace with:

> All four dialect specs ship inside `@askdb/core` — `ask({ dialect: "mysql" })`
> works without installing anything else. The engine packages
> (`@askdb/mysql`, `@askdb/postgres`, …) supply the *introspection*
> connector for that engine (and re-export its dialect constant for
> convenience); you need them to introspect, not to generate.

**2d.** After the paragraph at line 61 ("The schema artifact records which
engine it was introspected from…"), add this sentence to the same paragraph:

> This holds for Prisma-introspected artifacts too: the connector reads the
> `datasource.provider` from your `.prisma` file (`postgresql` → `postgres`,
> `mysql`, `sqlite`, `sqlserver`) and records it, so `askdb ask` still knows
> the dialect without a live database.

**Verify**: `grep -n "URL scheme\|enables.*the dialect\|what \*enables\*" apps/docs-site/src/content/docs/guides/switch-engines.mdx` → no matches; `grep -n "datasource.provider" apps/docs-site/src/content/docs/guides/switch-engines.mdx` → 1 match.

### Step 3: `concepts/modes-and-dialects.mdx` — where dialects live

File: `apps/docs-site/src/content/docs/concepts/modes-and-dialects.mdx`

Lines 12-18 currently read:

> A dialect is an `AskDialect` implementation supplied by an engine package. It tells `@askdb/core` how to:
>
> - Construct identifiers and quoting for this engine.
> - Format dialect-specific clauses (LIMIT vs TOP, dollar parameters vs question marks, JSON path syntax).
> - Validate what counts as a read-only `SELECT` on this engine.
>
> Each engine ships its dialect as a first-class package. Pick the one that matches your database.

Replace with:

> A dialect is a `DialectSpec` built into `@askdb/core` — all four ship with
> the core package. It tells the pipeline how to:
>
> - Construct identifiers and quoting for this engine.
> - Format dialect-specific clauses (LIMIT vs TOP, dollar parameters vs question marks, JSON path syntax).
> - Validate what counts as a read-only `SELECT` on this engine.
>
> The per-engine packages add introspection for their engine and re-export
> its dialect constant; `ask()` itself needs only the dialect id. The CLI
> resolves the id automatically: `dialect` in `askdb.config.ts` →
> the provider recorded in the schema artifact (for Prisma artifacts, the
> `datasource.provider` from your `.prisma` file) → `postgres`.

In the table below it (lines 20-25), change the column header `Package` to
`Engine package (introspection)` and leave the rows otherwise unchanged.

**Verify**: `grep -n "supplied by an engine package\|first-class package" apps/docs-site/src/content/docs/concepts/modes-and-dialects.mdx` → no matches.

### Step 4: `guides/embed-in-node.mdx` — `@askdb/postgres` is not needed for `ask()`

File: `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`

**4a.** Line 13 install command currently:

```bash
npm install @askdb/core @askdb/postgres @ai-sdk/openai pg
```

Replace with:

```bash
npm install @askdb/core @ai-sdk/openai pg
```

**4b.** In the package table (lines 16-21), delete the `@askdb/postgres` row:

> | `@askdb/postgres` | The Postgres dialect adapter (swap for `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`). |

and append this row instead (after the `@askdb/core` row):

> | — | Dialects for all four engines are built into `@askdb/core`; install `@askdb/postgres` only if this service also runs `askdb introspect` programmatically. |

(If a literal `—` cell renders oddly, use `*(no extra package)*` as the first
cell instead — check the built page.)

**4c.** In "## Switching engines" (line 120), the sentence "Install the
engine's adapter package, then change `dialect: "postgres"` …" — delete the
words "Install the engine's adapter package, then", so it reads:

> Same `ask()` call, different dialect string. Change `dialect: "postgres"` to `"mysql"`, `"sqlite"`, or `"sqlserver"`. See [Switch engines](/guides/switch-engines/) for the full migration matrix.

**Verify**: `grep -n "@askdb/postgres" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → exactly 1 match (the new table row).

### Step 5: `reference/packages.mdx` — engine-adapter framing and RAG exports

File: `apps/docs-site/src/content/docs/reference/packages.mdx`

**5a.** Line 101 currently reads:

> Each engine adapter ships the dialect (SQL generation + validation), the introspection connector (for schema artifacts), and any templates the dialect uses.

Replace with:

> Each engine package ships the introspection connector for its engine, any
> catalog SQL templates, and a re-export of that engine's dialect constant.
> The dialect specs themselves (SQL generation + validation rules) live in
> `@askdb/core` — `ask()` needs only the dialect id, no engine package.

**5b.** In the `@askdb/rag` "Key exports" table (lines ~193-196), replace the
row:

> | `indexSchema({ schema, store, embedder })` | Index a schema artifact's chunks. |

with these two rows:

> | `buildSchemaIndex({ schema, store, embedder, … })` | Chunk + embed + upsert a schema artifact; returns `{ retriever, stats, chunks }`. |
> | `createAiSdkEmbedder({ model })` / `createOpenAiEmbedder(…)` | Wrap an AI SDK embedding model (or raw OpenAI) as the `embedder`. |

Keep the `createRetriever` and `createPgvectorStore` rows unchanged.

**Verify**: `grep -n "indexSchema" apps/docs-site/src/content/docs/reference/packages.mdx` → no matches.

### Step 6: `reference/cli.mdx` — `askdb ask` flags table

File: `apps/docs-site/src/content/docs/reference/cli.mdx`

The flags table at lines 110-118 currently contains:

> | `--schema <path>` | Path to the schema artifact (required). |
> | `--question <text>` | The natural-language question (required). |
> | `--dialect <id>` | Override dialect: `postgres`, `mysql`, `sqlite`, `sqlserver`. |
> | `--mode <mode>` | Operating mode: `schema_only` (default) or `bounded_results`. |
> | `--omit-sensitive-from-prompt` | Exclude sensitive columns from the prompt entirely. |
> | `--log-level <level>` | Log level (default reads from `ASKDB_LOG_LEVEL`). |
> | `-v`, `--verbose` | Show structured log events. |

Replace the whole table with:

> | Flag | Description |
> | --- | --- |
> | `-s, --schema <path>` | Path to the schema artifact. Optional — defaults to the configured `introspection.outputDir`, or `./askdb/`. |
> | `-q, --question <text>` | The natural-language question (required). |
> | `--mode <mode>` | Operating mode: `schema_only` (default) or `bounded_results`. |
> | `--explain` | After the SQL, print a JSON block describing the heuristic guardrails satisfied. |
> | `--omit-sensitive-from-prompt` | Exclude sensitive columns from the prompt entirely. |
> | `--log-level <level>` | Log level (default reads from `ASKDB_LOG_LEVEL`). |
> | `-v`, `--verbose` | Show structured log events. |

Then, directly under the table (before the line "`askdb ask` returns the
validated SQL on stdout…"), add this paragraph:

> There is no dialect flag: the dialect resolves from `dialect` in
> `askdb.config.ts`, falling back to the provider recorded in the schema
> artifact at introspection time, then to `postgres`.

Also update the example command at lines 104-108 to drop the now-optional
flag *or* keep it — keep it as is (explicit is fine for a reference page).

**Verify**: `grep -n '\-\-dialect' apps/docs-site/src/content/docs/reference/cli.mdx` → no matches; `grep -n '\-\-explain' apps/docs-site/src/content/docs/reference/cli.mdx` → 1 match.

### Step 7: `guides/rag-for-large-schemas.mdx` — real indexing API

File: `apps/docs-site/src/content/docs/guides/rag-for-large-schemas.mdx`

Replace the "## Index the schema artifact" code block (lines 91-108):

```ts
import { createPgvectorStore, indexSchema } from "@askdb/rag";
import { loadSchema } from "@askdb/core";
import { openai } from "@ai-sdk/openai";

const schema = await loadSchema("./my-app.schema");

const store = createPgvectorStore({
  connectionString: process.env.ASKDB_PGVECTOR_URL!,
  dimensions: 1536,
});

await indexSchema({
  schema,
  store,
  embedder: openai.embedding("text-embedding-3-small"),
});
```

with:

````markdown
```ts
import {
  buildSchemaIndex,
  createAiSdkEmbedder,
  createPgvectorStore,
  loadChunkerSourcesFromDir,
} from "@askdb/rag";
import { openai } from "@ai-sdk/openai";

const store = createPgvectorStore({
  connectionString: process.env.ASKDB_PGVECTOR_URL!,
  dimensions: 1536,
});

const embedder = createAiSdkEmbedder({
  model: openai.textEmbeddingModel("text-embedding-3-small"),
});

const { retriever, stats } = await buildSchemaIndex({
  schema: loadChunkerSourcesFromDir("./my-app.schema"),
  store,
  embedder,
  embedderId: "openai:text-embedding-3-small", // changes force a full re-embed
  lockFilePath: "./my-app.schema/schema.lock.json", // skip unchanged chunks
});
```

`buildSchemaIndex` chunks the artifact, embeds only what changed since the
last run (tracked in `schema.lock.json`), and returns a ready-to-use
`retriever` plus indexing stats.
````

Then, in "## Wire retrieval into `ask()`" (lines 116-130): the
`createRetriever({ store, embedder })` example is correct — keep it, but
add one sentence before the code block:

> If you just ran `buildSchemaIndex` in the same process, pass its returned
> `retriever` directly. To retrieve in a separate process (the common
> production shape), rebuild one from the store:

**Verify**: `grep -n "indexSchema\|openai.embedding(" apps/docs-site/src/content/docs/guides/rag-for-large-schemas.mdx` → no matches.

### Step 8: `guides/integrations/prisma.mdx` — nonexistent env var

File: `apps/docs-site/src/content/docs/guides/integrations/prisma.mdx`

Line 43 currently reads:

> Set `ASKDB_PRISMA_SCHEMA` in `.env` (or `askdb.config.ts`) to make `--prisma-schema` optional on repeat runs.

Replace with:

> To make `--prisma-schema` optional on repeat runs, set
> `introspection.providerConfig.prisma.schemaPath` in `askdb.config.ts` —
> or rely on auto-discovery: with `provider: "prisma"` and no path
> configured, AskDB finds `prisma/schema.prisma` (or `schema.prisma`) in
> your project root automatically.

**Verify**: `grep -rn "ASKDB_PRISMA_SCHEMA" apps/docs-site/src/` → no matches.

### Step 9: `reference/config.mdx` — discovery, runtime example, precedence

File: `apps/docs-site/src/content/docs/reference/config.mdx`

**9a.** Replace the "## File discovery" list and trailing paragraph
(lines 53-64):

> 1. `askdb.config.ts`
> 2. `askdb.config.mts`
> 3. `askdb.config.cts`
> 4. `askdb.config.js`
> 5. `askdb.config.mjs`
> 6. `askdb.config.cjs`
> 7. `askdb.config.json`
> 8. `.config/askdb.*` (any of the above extensions)
>
> The first match wins. Looks in the current working directory, then walks up to find a project root.

with:

> `bootstrapAskDbEnv()` looks for config in the **current working directory
> only** (no upward walk), trying two locations in order:
>
> 1. `askdb.config.<ext>` — extension precedence `ts → mts → cts → js → mjs → cjs`
> 2. `.config/askdb.<ext>` — same extension precedence
>
> The first match wins. JSON config files are not supported. If nothing is
> found, `bootstrapAskDbEnv()` throws — run your process from the directory
> that holds the config (or pass `cwd` in its options).

**9b.** In "## Reading config at runtime" (lines 124-132), the example reads
a field that doesn't exist (`rt.schema.path`). Replace the code block with:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";

bootstrapAskDbEnv({ cwd: process.cwd() });

const rt = getAskDbRuntimeConfig();
const aiEnv = rt.ai.aiEnv;                    // provider + key/model env map
const outputDir = rt.introspection.outputDir; // resolved artifact directory
```

**9c.** Replace the "## Config precedence" section body (lines 138-145):

> For any given setting, the precedence (highest wins) is:
>
> 1. Function-call arguments (`ask({ mode: "..." })` etc.).
> 2. Environment variables.
> 3. `askdb.config.*` file.
> 4. Built-in defaults.
>
> This lets you ship a config file with sensible defaults and override per-environment via env vars without rebuilding.

with:

> For any given setting, the precedence (highest wins) is:
>
> 1. Per-call arguments — CLI flags (`--mode`, `--schema`, …) and `ask()` options.
> 2. The `askdb.config.*` file — the single source of truth for the runtime snapshot.
> 3. Built-in defaults applied for optional fields (e.g. `outputDir` → `./askdb/`).
>
> Environment variables don't override the config file from the outside —
> they flow *through* it: every `env("VAR")` call in the config reads the
> environment when the file loads. `.env` is loaded first (without
> overwriting variables already set in the real environment), so the
> per-environment override story is: system env beats `.env`, and whatever
> `env()` reads lands in the snapshot. This still lets you ship one config
> file and vary it per environment — just route each tunable through `env()`.

**Verify**: `grep -n "askdb.config.json\|walks up\|rt.schema.path" apps/docs-site/src/content/docs/reference/config.mdx` → no matches.

### Step 10: Build the site

**Verify**:
- `pnpm --filter docs-site lint` → exit 0.
- `pnpm --filter docs-site test` → exit 0 (builds with `ASTRO_BASE=/AskDB`
  and runs the base-path link checker).

## Test plan

Docs-only change — the per-step greps are the regression tests. Final sweep
(all from repo root, all must return no matches):

- `grep -rn "indexSchema" apps/docs-site/src/`
- `grep -rn "ASKDB_PRISMA_SCHEMA" apps/docs-site/src/`
- `grep -rn "picks the right dialect" apps/docs-site/src/`
- `grep -rn -- "--dialect" apps/docs-site/src/content/docs/reference/cli.mdx`
- `grep -rn "rt.schema.path\|askdb.config.json" apps/docs-site/src/`

## Done criteria

ALL must hold:

- [ ] `pnpm --filter docs-site lint` exits 0
- [ ] `pnpm --filter docs-site test` exits 0
- [ ] All five final-sweep greps above return no matches
- [ ] The quickstart config example uses `ai.providerConfig.openai.{apiKey, model}` and includes `introspection.provider`
- [ ] `git status` shows modifications only to the nine in-scope `.mdx` files, `plans/README.md`, and the pre-existing `index.mdx` change
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A "currently reads" excerpt in any step doesn't match the live file (the
  page was edited after `0f0c481`) — report which step and what you found.
- `askdb ask --help` semantics changed (e.g. `--schema` became required
  again, or a `--dialect` flag was added) — check `apps/cli/src/cli.ts`
  lines 262-300 if in doubt; the docs must follow the code as it is now.
- `@askdb/rag` exports changed (e.g. `buildSchemaIndex` renamed) — check
  `packages/rag/src/index.ts` before writing the Step 7 example.
- `pnpm --filter docs-site test` fails for a reason unrelated to your edits;
  report rather than patching build config or the link checker.

## Maintenance notes

- The CLI reference flags table is hand-maintained against
  `apps/cli/src/cli.ts`. Reviewers of any future CLI PR should diff
  `askdb ask --help` output against `reference/cli.mdx` — most of the drift
  fixed here would have been caught by that habit (a CI doc-drift check is a
  worthwhile follow-up, deferred from this plan).
- `install.mdx` line 13 still names OpenRouter in its requirements list with
  the qualifier "or any OpenAI-compatible endpoint" — acceptable today,
  deliberately left out of scope. Revisit if a first-party OpenRouter
  adapter ships.
- The precedence section now documents dotenv's no-overwrite behavior; if
  `bootstrapAskDbEnv` ever switches to `dotenv.config({ override: true })`,
  that paragraph must change too.
- The CLI reference remains *incomplete* (missing `introspect --from-export`,
  `--schemas/--exclude-schemas/--tables`, `introspect templates`,
  `studio --host`, `askdb-rag index|query`). Completeness was deferred —
  this plan only fixes incorrectness.

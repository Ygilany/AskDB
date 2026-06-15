# Plan 019: Stop presenting AskDB's internal `ASKDB_*` env-projection names as the user-facing knob

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **Read the "Editorial policy" and the per-file
> classification table before editing. The maintainer decided on 2026-06-14 that
> `askdb.config.ts` (plus CLI flags) is the single user-facing config surface —
> so EVERY `ASKDB_*` occurrence is reworded; none are kept.** When done, update
> the status row for this plan in `plans/README.md` — unless a reviewer
> dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs`
> If any in-scope file changed since this plan was written, compare its "Current
> state" excerpt against the live file before editing; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (cross-cutting doc edits)
- **Depends on**: none (touches no file owned by plans 014–018)
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14
- **Decision**: maintainer ruled on 2026-06-14 that `askdb.config.ts` + CLI flags
  are the only documented config surface — `ASKDB_SCHEMA_PATH` is reworded too,
  not kept. The HTTP server already loads its schema from the `host.schemaPath`
  config field (`apps/http-api/bin.ts` bootstraps config; verified at `4b80530`),
  so pointing readers at config instead of the env var is accurate.

## Why this matters

A user configures AskDB through `askdb.config.ts`, choosing **their own**
environment-variable names via the `env("…")` helper (e.g. `model:
env("OPENAI_MODEL")`). Internally, `@askdb/config`'s `flattenAskDbConfig`
projects that config into a flat set of `ASKDB_*` env keys (`ASKDB_AI_MODEL`,
`ASKDB_INTROSPECT_POSTGRES_URL`, `ASKDB_MODE`, …) that the first-party apps read
at runtime (`packages/config/src/runtime-config.ts` consumes them via
`pickFlat`). **Those `ASKDB_*` keys are an implementation detail of the
projection — not the surface a user is meant to set.** Several docs currently
present them as "the variable to set" (e.g. *"Override with `ASKDB_AI_MODEL`…"*),
which leaks internals and confuses the "you pick your own names" story.

This plan removes those internal names from the places they're shown as a user
knob, and redirects readers to the real surface: the config field (and the
provider-native env var the scaffold already binds it to) or the documented CLI
flag.

## Editorial policy (the rule every edit follows)

- **REWORD** an occurrence when an `ASKDB_*` name is presented as the variable a
  user should set. Replace it with guidance to set the corresponding **config
  field** (or its scaffold-bound provider-native var, or the CLI flag). Do not
  enumerate `ASKDB_*` names. **This applies to every `ASKDB_*` name, including
  `ASKDB_SCHEMA_PATH`** (per the maintainer decision above).
- **RENAME** occurrences that are just example variable names a user invented in
  their own code (not AskDB-internal mechanisms): `process.env.ASKDB_DATABASE_URL`
  and `os.environ['ASKDB_URL']` in sample snippets — rename to neutral names so
  the docs stop implying an `ASKDB_` convention (see the table).

## Current state — occurrence classification

| File | Line(s) | Occurrence | Action |
|------|---------|------------|--------|
| `guides/bring-your-own-model.mdx` | 43, 63, 102 | `ASKDB_AI_MODEL` in "Override with…" / "Set … or `ASKDB_AI_MODEL`" | REWORD (Step 1) |
| `reference/config.mdx` | 60–88 | Env table rows for `ASKDB_INTROSPECT_*`, `ASKDB_STUDIO_DATABASE_URL`, `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`, `ASKDB_LOG_LEVEL`, `ASKDB_MODE`, `ASKDB_INTROSPECT_OUT`, `ASKDB_ENV_PROJECTION`; custom-providers `ASKDB_AI_*` | REWORD (Step 2) |
| `reference/config.mdx` | 78, 79 | `ASKDB_SCHEMA_PATH`, `ASKDB_PGVECTOR_URL` rows | REWORD (Step 2) — see note |
| `guides/run-safely-in-prod.mdx` | 101 | `ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true` as the strict-mode knob | REWORD (Step 3) |
| `concepts/modes-and-dialects.mdx` | 36, 66 | `ASKDB_MODE`, `ASKDB_OMIT_SENSITIVE_FROM_PROMPT` env bindings | REWORD (Step 3) |
| `reference/cli.mdx` | 58, 117 | `ASKDB_INTROSPECT_OUT`, `ASKDB_LOG_LEVEL` flag fallbacks | REWORD (Step 3) |
| `reference/packages.mdx` | 69 | `ASKDB_AI_PROVIDER` ("Unknown `ASKDB_AI_PROVIDER` values…") | REWORD (Step 3) |
| `guides/run-safely-in-prod.mdx` | 33 | `process.env.ASKDB_DATABASE_URL` (sample) | RENAME to `DATABASE_URL` (Step 3) |
| `guides/deploy-as-http-service.mdx` | 83 | `os.environ['ASKDB_URL']` (sample client) | RENAME to `SERVER_URL` (Step 3) |
| `guides/rag-for-large-schemas.mdx` | 44, 59, 101 | `ASKDB_PGVECTOR_URL` (store connection) | REWORD (Step 3) — see note |
| `guides/deploy-as-http-service.mdx` | 31, 115 | `ASKDB_SCHEMA_PATH` | REWORD (Step 3) → `host.schemaPath` config field |
| `reference/http-api.mdx` | 68 | `ASKDB_SCHEMA_PATH` | REWORD (Step 3) → `host.schemaPath` config field |

Note on `ASKDB_PGVECTOR_URL` and `ASKDB_STUDIO_DATABASE_URL`: these are
flatten-projection names the scaffold *happens* to read via `env("…")`. They're
not magic — the user picks the name. Reword to a neutral, user-chosen name
(`PGVECTOR_URL`, `STUDIO_DATABASE_URL`) so the docs stop implying an `ASKDB_`
requirement, and keep the `env("…")` binding shape so the example still works.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |
| Final sweep check | `grep -rn "ASKDB_[A-Z_]" apps/docs-site/src/content/docs` | only the KEPT `ASKDB_SCHEMA_PATH` lines remain (3 total: deploy ×2, http-api ×1) |

## Scope

**In scope** (only these files):
- `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`
- `apps/docs-site/src/content/docs/reference/config.mdx`
- `apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx`
- `apps/docs-site/src/content/docs/concepts/modes-and-dialects.mdx`
- `apps/docs-site/src/content/docs/reference/cli.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx`
- `apps/docs-site/src/content/docs/guides/deploy-as-http-service.mdx`
- `apps/docs-site/src/content/docs/reference/http-api.mdx`
- `apps/docs-site/src/content/docs/guides/rag-for-large-schemas.mdx`

**Out of scope** (do NOT touch):
- `packages/**` and `apps/**` source — the projection mechanism and the env-read
  fallbacks stay as-is; this is a **docs-only** change. (`ASKDB_SCHEMA_PATH` keeps
  working as an undocumented fallback — we just stop teaching it.)
- Any `OPENAI_*`, `ANTHROPIC_*`, `AZURE_*`, `GOOGLE_*`, `DATABASE_URL` names —
  these are user-controlled provider/database names and are fine.

## Git workflow

- Branch: `advisor/019-hide-internal-env-names`
- Commit style: conventional, e.g. `docs: stop presenting internal ASKDB_* env keys as user knobs`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: bring-your-own-model.mdx — drop the `ASKDB_AI_MODEL` overrides

Three edits in `guides/bring-your-own-model.mdx`:

- **Line 43** (OpenAI tab). Replace:
  `Default model: \`gpt-4o-mini\`. Override with \`ASKDB_AI_MODEL\` or \`OPENAI_MODEL\` in your env.`
  with:
  `Default model: \`gpt-4o-mini\`. To use a different one, set \`model\` in \`providerConfig.openai\` (the scaffolded config reads it from \`OPENAI_MODEL\`).`

- **Line 63** (Anthropic tab). Replace:
  `Default model: \`claude-sonnet-4-6\`. Override with \`ASKDB_AI_MODEL\` or \`ANTHROPIC_MODEL\` in your env.`
  with:
  `Default model: \`claude-sonnet-4-6\`. To use a different one, set \`model\` in \`providerConfig.anthropic\` (bind it to \`ANTHROPIC_MODEL\` in your config).`

- **Line 102** (Azure tab). Replace:
  `Set \`AZURE_OPENAI_DEPLOYMENT\` (or \`ASKDB_AI_MODEL\`) to the deployment name you want to use.`
  with:
  `Set \`model\` in \`providerConfig.azure\` to your deployment name (the scaffolded config reads it from \`AZURE_OPENAI_DEPLOYMENT\`).`

**Verify**: `grep -c "ASKDB_AI_MODEL" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` → `0`.

### Step 2: config.mdx — reframe the Environment variables and custom-providers sections

In `reference/config.mdx`:

**(a) The env table (lines 60–84).** The intent: keep the *user-controlled
example names* the scaffold reads, and stop listing the internal `ASKDB_*`
projection as if the user sets it. Replace the whole `## Environment variables`
section body (from line 62 "AskDB reads `.env`…" through line 84 "exposed as
`ASKDB_ENV_PROJECTION`…") with:

```mdx
AskDB reads `.env` next to your process via `dotenv`, then evaluates your `askdb.config.*`. **You choose the variable names** — they're whatever you pass to `env("…")` in your config. The scaffolded config uses these common names; rename any of them in your config and `.env` together:

| Variable | Reads into (config field) | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | `ai.providerConfig.openai.apiKey` | Standard OpenAI key. |
| `OPENAI_MODEL` | `ai.providerConfig.openai.model` | Optional model override. Default: `gpt-4o-mini`. |
| `ANTHROPIC_API_KEY` | `ai.providerConfig.anthropic.apiKey` | When `ai.provider = "anthropic"`. Default model: `claude-sonnet-4-6`. |
| `AZURE_API_KEY`, `AZURE_RESOURCE_NAME` | `ai.providerConfig.azure.*` | Azure OpenAI. |
| `DATABASE_URL` | `introspection.providerConfig.postgres.databaseUrl` | Postgres introspection connection. |

Everything else AskDB needs — output directory, mode, log level, Studio query connection, the vector-store URL — is set the same way: a field in `askdb.config.ts`, bound to a name you choose with `env("…")`. You don't set any AskDB-prefixed variables yourself; AskDB derives its internal runtime values from your config.
```

(This deletes the `ASKDB_INTROSPECT_*`, `ASKDB_STUDIO_DATABASE_URL`,
`ASKDB_SCHEMA_PATH`, `ASKDB_PGVECTOR_URL`, `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`,
`ASKDB_LOG_LEVEL`, `ASKDB_MODE`, `ASKDB_INTROSPECT_OUT`, and `ASKDB_ENV_PROJECTION`
rows/sentence. The corresponding config fields are all still documented via the
`defineConfig` example at the top of the page.)

**(b) The custom-providers section (lines 87–88).** Replace the sentence:
`When an unknown provider string is used, \`flattenAskDbConfig\` applies the generic branch: \`ai.providerConfig.custom.{apiKey,baseUrl,model}\` flatten to the universal \`ASKDB_AI_API_KEY\` / \`ASKDB_AI_BASE_URL\` / \`ASKDB_AI_MODEL\` env keys.`
with:
`When an unknown provider string is used, AskDB applies a generic branch: you supply \`ai.providerConfig.custom.{apiKey, baseUrl, model}\` (each bound to a name you choose with \`env("…")\`), and AskDB hands them to whatever adapter is registered under that provider name.`

**Verify**: `grep -c "ASKDB_" apps/docs-site/src/content/docs/reference/config.mdx` → `0`.

### Step 3: Sweep the remaining pages per the classification table

Apply each edit below. After each file, run `cd apps/docs-site && pnpm lint`
(expect exit 0).

- **`guides/run-safely-in-prod.mdx`**
  - Line 33 (sample): rename `process.env.ASKDB_DATABASE_URL` → `process.env.DATABASE_URL`.
  - Line 101: replace `set \`ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true\` to omit sensitive columns from the prompt entirely`
    with `set \`modes.omitSensitiveFromPrompt: true\` in \`askdb.config.ts\` (or pass \`--omit-sensitive-from-prompt\`) to omit sensitive columns from the prompt entirely`.

- **`concepts/modes-and-dialects.mdx`**
  - Line 36: replace `\`modes.askdbMode\` in \`askdb.config.ts\` (env binding: \`ASKDB_MODE\`).`
    with `\`modes.askdbMode\` in \`askdb.config.ts\`.`
  - Line 66: replace `Omitted from the prompt entirely with \`--omit-sensitive-from-prompt\` (or \`ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true\`)`
    with `Omitted from the prompt entirely with \`modes.omitSensitiveFromPrompt: true\` in your config (or the \`--omit-sensitive-from-prompt\` flag)`.

- **`reference/cli.mdx`**
  - Line 58: replace `Falls back to \`ASKDB_INTROSPECT_OUT\`.`
    with `Falls back to \`introspection.outputDir\` in \`askdb.config.ts\`.`
  - Line 117: replace `default reads from \`ASKDB_LOG_LEVEL\``
    with `default reads from \`logging.level\` in \`askdb.config.ts\``.

- **`reference/packages.mdx`**
  - Line 69: replace `Unknown \`ASKDB_AI_PROVIDER\` values require a registered adapter`
    with `Unknown \`ai.provider\` values require a registered adapter`.

- **`guides/deploy-as-http-service.mdx`**
  - Line 83 (Python sample): rename `os.environ['ASKDB_URL']` → `os.environ['SERVER_URL']`.
  - Line 31: replace
    `The server reads its schema and model config from environment variables — set \`ASKDB_SCHEMA_PATH\` to point at your schema artifact, and the AI provider keys (\`OPENAI_API_KEY\`, etc.) as you normally would.`
    with
    `The server reads its schema and model settings from your \`askdb.config.ts\` (it bootstraps the same config file the CLI and Studio use). Set \`host.schemaPath\` to point at your schema artifact and configure the AI provider as usual — supply the provider key (\`OPENAI_API_KEY\`, etc.) in your environment the same way you do for the CLI.`
  - Line 115: replace
    `The default is to load \`ASKDB_SCHEMA_PATH\` once at boot.`
    with
    `The default is to load the schema from \`host.schemaPath\` once at boot.`

- **`reference/http-api.mdx`**
  - Line 68: replace the `schemaJson` table row
    `| \`schemaJson\` | no | env-driven | Inline schema artifact. Preferred: set \`ASKDB_SCHEMA_PATH\` server-side. |`
    with
    `| \`schemaJson\` | no | config-driven | Inline schema artifact. Preferred: set \`host.schemaPath\` in \`askdb.config.ts\` server-side. |`

- **`guides/rag-for-large-schemas.mdx`** — these examples read a vector-store
  URL; the name is the user's to pick. Rename the variable to a neutral
  `PGVECTOR_URL` in all three spots so it stops implying an `ASKDB_` convention:
  - Line 44: `process.env.ASKDB_PGVECTOR_URL` → `process.env.PGVECTOR_URL`.
  - Line 59: `--pg-url "$ASKDB_PGVECTOR_URL"` → `--pg-url "$PGVECTOR_URL"`.
  - Line 101: `process.env.ASKDB_PGVECTOR_URL!` → `process.env.PGVECTOR_URL!`.

**Verify**: `grep -rn "ASKDB_[A-Z_]" apps/docs-site/src/content/docs` returns
**zero matches** — every internal env name, including `ASKDB_SCHEMA_PATH`, is now
reworded to a config field or CLI flag.

## Test plan

Docs change — no unit tests. Gate is the build + link check:

- `cd apps/docs-site && pnpm test` → exit 0. Confirms every reworded page still
  parses and no internal anchor/link broke (the reworded text introduces no new
  links, but the build re-validates the whole site).

## Done criteria

ALL must hold:

- [ ] `grep -rn "ASKDB_[A-Z_]" apps/docs-site/src/content/docs` returns **zero**
      matches (every internal env name reworded, `ASKDB_SCHEMA_PATH` included)
- [ ] `bring-your-own-model.mdx` and `config.mdx` contain no `ASKDB_` strings
- [ ] No `OPENAI_*` / `ANTHROPIC_*` / `AZURE_*` / `DATABASE_URL` names were
      removed (those are user-facing and correct)
- [ ] `cd apps/docs-site && pnpm lint` exits 0; `pnpm test` exits 0
- [ ] Only the in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report (do not improvise) if:

- Any file's "Current state" / line reference doesn't match the live file (drift
  since `4b80530`) — re-locate the occurrence by `grep` before editing; if the
  surrounding sentence differs materially from this plan, STOP.
- An `ASKDB_*` name appears that is **not** in the classification table — reword
  it to the matching config field by the same rule; if you can't identify the
  config field, report it rather than guessing.
- Rewording would require changing a config field name you can't confirm exists
  (e.g. `modes.omitSensitiveFromPrompt`, `introspection.outputDir`, `logging.level`,
  `host.schemaPath` — all confirmed: the first three in `reference/config.mdx`'s
  own examples / `concepts/modes-and-dialects.mdx`, and `host.schemaPath` in
  `reference/config.mdx:78` and `packages/config/src/types.ts`). If a field name
  doesn't resolve, STOP.

## Maintenance notes

- The single user-facing rule going forward: docs describe **config fields** and
  user-chosen `env("…")` names (and CLI flags), never the `ASKDB_*` projection.
  There is no sanctioned exception — reviewers should reject any `ASKDB_*` name in
  user-facing docs. (`ASKDB_SCHEMA_PATH` still works at runtime as an
  undocumented fallback; the standalone HTTP server reads `host.schemaPath` from
  config, which is now the documented surface.)
- The standalone HTTP server has no `--schema-path` CLI flag yet — it's config- or
  env-driven only. Plan 020 adds CLI flags (`--schema-path`/`--port`/`--host`) so
  the "config file **or** CLI arg" surface is complete; until it lands, config
  (`host.schemaPath`) is the documented path. These plans are independent: 019 is
  honest without 020 because config-driven loading already works.
- `ASKDB_ENV_PROJECTION` (the full generated key list) is now undocumented on the
  site by design. If advanced users need it, it belongs in an "internals"
  reference, not the configuration page.
- A reviewer should confirm the config.mdx env table still teaches the
  "you choose your own names" point clearly after the row removals.

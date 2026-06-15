# Plan 020: Give the standalone HTTP server CLI flags (`--schema-path`, `--port`, `--host`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/http-api/src`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live files before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches the server's request-time schema resolution)
- **Depends on**: none (code). Soft-pairs with 019 (docs): once this lands, the
  HTTP docs can mention the flags alongside `host.schemaPath`.
- **Category**: dx
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

The maintainer's principle is that AskDB should be configured through
`askdb.config.ts` **or a CLI argument** — never raw internal `ASKDB_*` env vars
(see plan 019). For the standalone HTTP server that principle is half-met today:
the config path works (`apps/http-api/bin.ts` bootstraps config and the server
reads `host.schemaPath` via the projection), but **the server binary accepts no
CLI flags at all** — `bin.ts` parses nothing. So a user who wants to point the
server at a schema or change the port without editing config is forced back onto
the `ASKDB_SCHEMA_PATH` env var we're trying to stop advertising.

This plan adds `--schema-path`, `--port`, and `--host` flags to the server
binary, with precedence **CLI flag > config > built-in default**. After it lands,
"config file or CLI arg" is a complete, honest surface and the docs never need to
mention an `ASKDB_*` name.

## Current state

- `apps/http-api/src/bin.ts` — the `#!/usr/bin/env node` entry. It bootstraps
  config, then:
  ```ts
  const { httpApi } = getAskDbRuntimeConfig();
  const app = createAskDbHttpServer({ port: httpApi.listen.port, host: httpApi.listen.host });
  await app.listen();
  console.log(`AskDB HTTP API listening on http://${app.host}:${app.port}`);
  ```
  It does **not** read `process.argv`. It never passes a schema path —
  the server resolves that itself.

- `apps/http-api/src/server.ts`:
  - `AskDbHttpServerOptions` (lines 36–43) currently:
    ```ts
    export type AskDbHttpServerOptions = {
      /** Default: 3000 */
      port?: number;
      /** Default: 127.0.0.1 */
      host?: string;
      /** Default: 1 MiB */
      maxBodyBytes?: number;
    };
    ```
  - `createAskDbHttpServer(options = {})` (line 176) sets `host`/`port`/`maxBodyBytes`.
  - At request time the server resolves the server-default schema from the config
    projection. The relevant reads (lines ~127, ~277–285) use
    `rt.ai.aiEnv.ASKDB_SCHEMA_PATH`:
    ```ts
    const p = rt.ai.aiEnv.ASKDB_SCHEMA_PATH;            // ~line 127, getServerDefaultSchema
    ...
    } else if (rt.ai.aiEnv.ASKDB_SCHEMA_PATH && rt.ai.aiEnv.ASKDB_SCHEMA_PATH.trim() !== "") {  // ~line 277
      const { resolvedPath, source } = await resolveSchemaPathWithFallbacks(rt.ai.aiEnv.ASKDB_SCHEMA_PATH);
    ```
  - `resolveSchemaPathWithFallbacks(schemaPath)` (line 134) already exists and is
    reused.

- `apps/http-api/src/server.integration.test.ts` — the existing test suite;
  model new tests on its structure (it boots a server and issues requests).

- **Conventions**: the studio CLI (`apps/studio/src/cli.ts`) is the in-repo model
  for a tiny hand-rolled arg parser with `--flag value` pairs, a `readValue`
  helper, and precedence `flag ?? config ?? env ?? default`. Match its style —
  do **not** add a `commander`/`yargs` dependency to `@askdb/http-api`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm --filter @askdb/http-api typecheck` (or `pnpm -w typecheck`) | exit 0 |
| Tests (this pkg) | `pnpm --filter @askdb/http-api test` | all pass |
| Lint | `pnpm --filter @askdb/http-api lint` | exit 0 |

Verify the exact script names first: `cat apps/http-api/package.json` and use the
`scripts` it actually defines. If a script is missing, fall back to the root
equivalents (`pnpm -w test`, `pnpm -w typecheck`). If neither resolves, STOP.

## Scope

**In scope**:
- `apps/http-api/src/bin.ts` (parse flags, thread overrides)
- `apps/http-api/src/server.ts` (add `schemaPath` option; prefer it over the
  config projection)
- `apps/http-api/src/server.integration.test.ts` (new tests)

**Out of scope** (do NOT touch):
- The `ASKDB_SCHEMA_PATH` env read itself — keep it as the fallback when no flag
  and no `host.schemaPath` is set. This plan **adds** a higher-precedence source,
  it does not remove the env fallback.
- `packages/config/**` — no config-schema change; `host.schemaPath` already exists.
- The docs — plan 019 owns the doc rewrite; a follow-up can mention these flags.

## Git workflow

- Branch: `advisor/020-http-server-cli-flags`
- Commit style: conventional, e.g. `feat(http-api): --schema-path/--port/--host CLI flags`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a `schemaPath` option to the server and prefer it over the env projection

In `apps/http-api/src/server.ts`:

1. Add `schemaPath?: string;` to `AskDbHttpServerOptions` (with a doc comment:
   "Server-default schema artifact path. Precedence: this option → `host.schemaPath`
   config → `ASKDB_SCHEMA_PATH` env.").
2. In `createAskDbHttpServer`, capture `const optionSchemaPath = options.schemaPath;`.
3. At every place the server currently reads `rt.ai.aiEnv.ASKDB_SCHEMA_PATH` as
   the server-default schema (the `getServerDefaultSchema` read near line 127 and
   the request-handler branch near line 277), resolve the effective path as
   `optionSchemaPath ?? rt.ai.aiEnv.ASKDB_SCHEMA_PATH` **before** the existing
   logic, and feed that into `resolveSchemaPathWithFallbacks(...)`. Keep the
   "no schema configured" error path unchanged for the case where the effective
   path is empty/undefined. Do not change the `schemaJson` per-request override
   behavior.

Keep the change minimal: a single resolved `effectiveSchemaPath` variable reused
in both spots is cleaner than duplicating the `??`.

**Verify**: `pnpm --filter @askdb/http-api typecheck` → exit 0. Then
`grep -n "schemaPath" apps/http-api/src/server.ts` shows the new option and its use.

### Step 2: Parse `--schema-path`, `--port`, `--host` in `bin.ts`

In `apps/http-api/src/bin.ts`, after `bootstrapAskDbEnv(...)` and
`getAskDbRuntimeConfig()`, add a small arg parser (modeled on
`apps/studio/src/cli.ts`'s `parseOptions`/`readValue`) over
`process.argv.slice(2)` recognizing:

- `--schema-path <path>` → `cliSchemaPath`
- `--port <n>` → `cliPort` (validate integer 1–65535; on invalid, print an error
  to stderr and exit 1)
- `--host <host>` → `cliHost`
- `--help` / `-h` → print a short usage block and exit 0
- unknown flag → print error to stderr and exit 1

Then build the server with precedence flag → config → default:

```ts
const app = createAskDbHttpServer({
  port: cliPort ?? httpApi.listen.port,
  host: cliHost ?? httpApi.listen.host,
  schemaPath: cliSchemaPath,   // undefined falls through to config/env in the server
});
```

The help text must describe the three flags and state the precedence (CLI flag
overrides `askdb.config.ts`). Do **not** mention `ASKDB_SCHEMA_PATH` in the help
text (consistent with plan 019).

**Verify**: build the binary and run help:
`pnpm --filter @askdb/http-api build && node apps/http-api/dist/bin.js --help`
→ prints usage listing `--schema-path`, `--port`, `--host`; exit 0.
(If the build script differs, use the one in `apps/http-api/package.json`.)

### Step 3: Tests

In `apps/http-api/src/server.integration.test.ts`, add tests (model their setup
on the existing tests in the file):

1. `createAskDbHttpServer({ schemaPath })` uses the provided artifact: POST a
   question with no `schemaJson` in the body and assert it resolves SQL from the
   option's schema (use the repo fixture `fixtures/schemas/orders-users.schema/`
   referenced elsewhere in the codebase as a known-good v2 directory).
2. Precedence: when both `schemaPath` option and `ASKDB_SCHEMA_PATH` in the
   passed env are set, the option wins. (If the existing tests inject env via the
   runtime config, follow that pattern; if env injection isn't feasible in-test,
   cover option-vs-default instead and note it.)

**Verify**: `pnpm --filter @askdb/http-api test` → all pass, including the new
tests.

## Test plan

- New tests live in `apps/http-api/src/server.integration.test.ts`, patterned on
  the existing server-boot tests there.
- Cases: (a) `schemaPath` option drives schema resolution; (b) option takes
  precedence over the config/env projection; (c) no schema configured anywhere
  still returns the existing "No schema configured" error.
- Verification: `pnpm --filter @askdb/http-api test` → all pass.

## Done criteria

ALL must hold:

- [ ] `AskDbHttpServerOptions` has `schemaPath?: string` and the server prefers it
      over `rt.ai.aiEnv.ASKDB_SCHEMA_PATH`
- [ ] `apps/http-api/dist/bin.js --help` lists `--schema-path`, `--port`, `--host`
      and does not mention `ASKDB_SCHEMA_PATH`
- [ ] CLI precedence holds: flag > config > default (covered by a test)
- [ ] `pnpm --filter @askdb/http-api typecheck` exits 0; `… lint` exits 0;
      `… test` all pass (incl. new tests)
- [ ] Only the three in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since `4b80530`)
  — in particular if the server no longer resolves the schema via
  `rt.ai.aiEnv.ASKDB_SCHEMA_PATH`, the threading point has moved; report it.
- Threading `schemaPath` turns out to require changes in `packages/**` (it should
  not — the override lives entirely in `apps/http-api`). If it does, STOP.
- A test needs to set process env in a way the existing suite doesn't already
  demonstrate — cover the option-vs-default case and report the gap rather than
  inventing a brittle env-injection harness.

## Maintenance notes

- After this lands, update plan 019's reworded HTTP docs (or open a tiny doc
  follow-up) to mention `askdb-http --schema-path …` alongside `host.schemaPath` —
  so readers see both the config and CLI surfaces. Keep `ASKDB_SCHEMA_PATH` out
  of the docs.
- A reviewer should confirm the env fallback still works for existing deployments
  that set `ASKDB_SCHEMA_PATH` (backward compatibility — this plan only *adds* a
  higher-precedence source).
- If `--port`/`--host` ever need to also flow into the per-request schema
  resolution or TLS, that's separate; this plan is listen-address + schema only.

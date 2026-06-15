# Plan 025: Migrate the HTTP API and CLI onto `@askdb/client`, deleting duplicated resolution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d7faa20..HEAD -- apps/http-api/src/server.ts apps/cli/src/cli.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition. Also confirm `@askdb/client` exists
> (`ls packages/client/src/client.ts`) — this plan depends on plan 024.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches two working, shipped hosts; behavior must be preserved exactly)
- **Depends on**: plans/024-askdb-client-facade.md (hard)
- **Category**: tech-debt
- **Planned at**: commit `d7faa20`, 2026-06-15

## Why this matters

`apps/http-api/src/server.ts` and `apps/cli/src/cli.ts` each carry a near-verbatim
copy of schema resolution, model resolution (incl. the mock-SQL `generateText`
shim), and dialect resolution before calling `ask()`. Plan 024 created
`@askdb/client.createAskDb()` which centralizes exactly this. This plan replaces
the duplicated logic in both hosts with the facade, so there is one resolution
path to reason about and the next host (or example) is trivial to write. Behavior
must be **identical** — same dialect precedence, same mock path, same error
messages where users can observe them.

## Current state

### HTTP API — `apps/http-api/src/server.ts`

The duplicated pieces (read the whole `createAskDbHttpServer` body,
lines ~181–340):

- `resolveSchemaJsonFromRt` (lines 121–137), `resolveSchemaPathWithFallbacks`
  (lines 139–160), `resolveHttpApiDialect` (lines 167–179).
- The registry: `const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider]);` (line 34).
- Per-request resolution (lines 255–329):

```ts
const mockSql = rt.dev.mockSql;
const aiConfig = mockSql ? undefined : ai.resolveAiConfig(rt.ai.aiEnv);
if (!mockSql && !aiConfig) { /* writeError generation_not_configured */ }
// ...
let schema;
try {
  const requestOverride = typeof body.schemaJson === "string" && body.schemaJson.trim() !== "" ? body.schemaJson : undefined;
  if (requestOverride) { schema = loadSchemaFromJson(requestOverride); }
  else { /* cachedSchema from ASKDB_SCHEMA_JSON / ASKDB_SCHEMA_PATH with resolveSchemaPathWithFallbacks */ }
} catch (e) { /* writeError schema_parse_error */ }

type AskModel = Parameters<typeof ask>[0]["model"];
const model: AskModel = mockSql
  ? (undefined as unknown as AskModel)
  : ((await ai.createLanguageModelFromEnv(rt.ai.aiEnv)) as AskModel);

const schemaProvider = "provider" in schema && typeof schema.provider === "string" ? schema.provider : undefined;
const dialect = resolveHttpApiDialect(rt.nlToSql.dialect, schemaProvider);

const out = await ask({
  question: body.question,
  schema,
  model,
  // deps: mockSql !== undefined ? { generateText: async () => ({ text: mockSql }) } : undefined  (lines 326-329)
  // ...other options
});
```

The HTTP server has request-specific concerns the facade does NOT replace and
which must be preserved:
- **`schemaJson` request-body override** → maps to a per-call
  `overrides.schema = { json: body.schemaJson }`.
- **Structured error responses**: a schema parse failure must still return HTTP
  400 `schema_parse_error`; a missing key must still return 500
  `generation_not_configured`. The facade throws plain `Error`s, so the host
  wraps the `askdb.ask(...)` call in try/catch and maps failures to these codes.
- **The `cachedSchema` across requests** is now the facade's internal cache (one
  facade instance created once in `createAskDbHttpServer`, not per request).

### CLI — `apps/cli/src/cli.ts`

The duplicated pieces:
- `loadSchemaFromPath` (lines 96–114), `resolveSchemaPathForAsk` (lines 116–121),
  `resolveAskDbDialect` (lines 178–203, returns `{ dialect, source, note }`).
- The registry (`const ai = createAiRegistry([...])`, near top of file — confirm
  its line).
- Per-invocation resolution (lines 333–396):

```ts
const mockSql = opts.mockSql ?? runtime.dev.mockSql;
const aiConfig = mockSql ? undefined : ai.resolveAiConfig(runtime.ai.aiEnv);
if (!mockSql && !aiConfig) { /* error */ }
// ...
const schemaPath = resolveSchemaPathForAsk(opts.schema, runtime);
const schema = loadSchemaFromPath(schemaPath);
const schemaProvider = /* schema.provider if string */;
const resolvedDialect = resolveAskDbDialect(runtime.nlToSql.dialect, schemaProvider);
if (resolvedDialect.note) { logger.info(...); console.error(`Note: ${resolvedDialect.note}`); }

const model: AskModel = mockSql ? (undefined as unknown as AskModel) : (await ai.createLanguageModelFromEnv(runtime.ai.aiEnv));
const out = await ask({ question: opts.question, schema, model, dialect: resolvedDialect.dialect, deps: mockSql !== undefined ? {...} : undefined, ... });
```

CLI-specific concerns to preserve:
- **`--schema` option** overrides the default schema path
  (`opts.schema ?? runtime.introspection.outputDir`). Map to
  `overrides.schema = { path }` when `opts.schema` set; otherwise let the facade
  fall back — **but note**: the CLI's default is `runtime.introspection.outputDir`,
  which the facade does NOT know about. So the CLI must pass the resolved default
  path into `createAskDb({ schema: { path: resolveSchemaPathForAsk(opts.schema, runtime) } })`
  (keep `resolveSchemaPathForAsk` for this), OR pass it per-call. Keep
  `resolveSchemaPathForAsk` and `loadSchemaFromPath`'s **error wrapping** (it maps
  ENOENT/EACCES/parse to friendly `AskDbError`s the CLI prints) — see "Decision"
  below.
- **`--mock-sql` flag** (`opts.mockSql`) overrides `runtime.dev.mockSql`. The
  facade only reads `config.dev.mockSql`, so when `opts.mockSql` is set the CLI
  must pass it via a per-call `deps.generateText` override.
- **Dialect "note"** printed to stderr (`console.error(\`Note: ...\`)`) and logged
  — wire via the facade's `onResolve` hook (`info.dialect.note`).
- **Sensitive-SQL warning** scan (`findSensitiveReferencesInSql`, needs the loaded
  `schema`) — the facade does not return the schema object. Keep this working by
  loading the schema in the CLI (it already does) OR exposing it; see Decision.

### Decision — how far to push each host through the facade

To keep risk low and preserve every observable behavior:

- **HTTP API**: full migration. Create the facade once in
  `createAskDbHttpServer`; per request call `askdb.ask(body.question, { schema: requestOverride ? { json } : undefined, mode, explain, ... })`. Wrap in
  try/catch to map errors to the existing HTTP codes. The facade's internal cache
  replaces `cachedSchema`. Delete `resolveSchemaJsonFromRt`,
  `resolveSchemaPathWithFallbacks`, `resolveHttpApiDialect`, and the inline model
  resolution. **Keep** `resolveSchemaPathWithFallbacks`'s repo-root fallback ONLY
  if a test depends on it — see STOP condition; if so, pass a pre-resolved
  `schema: { path }` to the facade instead of deleting it.
- **CLI**: partial migration. The CLI still needs the loaded `schema` object for
  the sensitive-SQL scan and keeps its friendly `AskDbError` wrapping. So:
  load the schema with the existing `loadSchemaFromPath` (keep it), then pass the
  **pre-loaded schema** to the facade per call: `askdb.ask(opts.question, { schema: { schema }, ... })`. This still deletes the **dialect** and **model**
  duplication (the high-value part) while preserving the CLI's schema UX. Use the
  `onResolve` hook for the dialect note.

This is deliberately asymmetric: the HTTP path has no per-call schema-object
consumer, so it fully delegates; the CLI consumes the schema object, so it loads
then delegates the rest.

### Conventions

- Both hosts already import from `@askdb/core`, `@askdb/ai`, `@askdb/config`. Add
  `@askdb/client` as a dependency in each app's `package.json` (`"@askdb/client": "workspace:*"`), then `pnpm install`.
- Match each file's existing error-handling style (HTTP: `writeError(res, status, correlationId, {...})`; CLI: `throw new AskDbError(...)` / `console.error`).

## Commands you will need

| Purpose            | Command                                   | Expected            |
|--------------------|-------------------------------------------|---------------------|
| Install            | `pnpm install`                            | exit 0              |
| Build client+deps  | `pnpm --filter @askdb/client build`       | exit 0              |
| Typecheck http     | `pnpm --filter @askdb/http-api lint`      | exit 0              |
| Test http          | `pnpm --filter @askdb/http-api test`      | all pass            |
| Typecheck cli      | `pnpm --filter askdb lint`                | exit 0              |
| Test cli           | `pnpm --filter askdb test`                | all pass            |
| Full build         | `pnpm build`                              | exit 0              |

(Confirm the CLI package name with `node -p "require('./apps/cli/package.json').name"` — it is `askdb` per the root devDependency; adjust `--filter` if different. Same for http-api via `apps/http-api/package.json`.)

## Scope

**In scope**:
- `apps/http-api/src/server.ts`
- `apps/http-api/package.json` (add `@askdb/client` dep)
- `apps/cli/src/cli.ts`
- `apps/cli/package.json` (add `@askdb/client` dep)
- `.changeset/migrate-hosts-to-client.md` (create)
- Existing host tests only if they assert internal helpers being removed (adjust, don't delete coverage).

**Out of scope**:
- `packages/client/**` — finished in plan 024; do not change the facade to fit a
  host. If a host needs something the facade lacks, STOP and report.
- `apps/studio/**` — Studio has its own flow; migrate later if desired.
- `examples/**` — plan 026.
- Any change to the HTTP `/ask` response shape or error codes — clients depend on
  them.

## Git workflow

- Branch: `advisor/025-migrate-hosts-to-client`
- Commit per host (http first, then cli) so each is independently reviewable.
- Conventional commits, e.g. `refactor(http-api): resolve schema/model/dialect via @askdb/client`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the dependency to both apps

Add `"@askdb/client": "workspace:*"` to `dependencies` in
`apps/http-api/package.json` and `apps/cli/package.json`. Run `pnpm install`.

**Verify**: `pnpm install` → exit 0; `node -p "require('./apps/http-api/package.json').dependencies['@askdb/client']"` prints `workspace:*`.

### Step 2: Migrate the HTTP API

In `apps/http-api/src/server.ts`:
1. Import `createAskDb` from `@askdb/client`.
2. In `createAskDbHttpServer`, build the facade once after computing options:
   ```ts
   const askdb = createAskDb({
     config: /* a runtime config — note rt is fetched per request today */,
     registry: ai,
     schema: optionSchemaPath ? { path: optionSchemaPath } : undefined,
     onResolve: (info) => { /* optional: logger.info dialect source */ },
   });
   ```
   **Important**: today `rt = getAskDbRuntimeConfig()` is read **per request**
   (line 204). The facade caches against the config it was given at construction.
   Resolve this by constructing the facade lazily inside the handler the first
   time, OR construct it per request (cheap) and rely on the facade only for the
   single call — but then the schema cache is lost. **Preferred**: construct the
   facade once, lazily, on first request, capturing that request's `rt` (config
   is stable for the process lifetime after bootstrap). If unsure whether config
   is stable, STOP and report rather than guessing.
3. Replace the schema/model/dialect block (lines ~255–329) with:
   ```ts
   try {
     const requestOverride = typeof body.schemaJson === "string" && body.schemaJson.trim() !== "" ? body.schemaJson : undefined;
     const out = await askdb.ask(body.question, {
       schema: requestOverride ? { json: requestOverride } : undefined,
       mode,
       explain: /* existing */,
       // ...forward the same options ask() received before
     });
     // ...existing success response using `out`
   } catch (e) {
     // Map: message includes "No schema configured" / parse failure → 400 schema_parse_error or bad_request;
     //      message === keyMissingMessage(...) → 500 generation_not_configured.
     // Preserve the existing error codes and messages.
   }
   ```
4. Delete `resolveSchemaJsonFromRt`, `resolveHttpApiDialect`, and the inline
   model resolution. **Keep** `resolveSchemaPathWithFallbacks` only if Step 4's
   tests need the repo-root fallback; otherwise delete it and rely on the
   facade's plain `loadSchema(path)`.

**Verify**: `pnpm --filter @askdb/http-api lint` → exit 0.

### Step 3: Migrate the CLI

In `apps/cli/src/cli.ts`:
1. Import `createAskDb` from `@askdb/client`.
2. Keep `loadSchemaFromPath`, `resolveSchemaPathForAsk` (CLI schema UX) and
   `findSensitiveReferencesInSql`. **Delete** `resolveAskDbDialect` (the facade
   replaces it) and the inline model resolution.
3. In the `ask` command handler (lines ~333–396):
   ```ts
   const schemaPath = resolveSchemaPathForAsk(opts.schema, runtime);
   const schema = loadSchemaFromPath(schemaPath);   // keep: friendly errors + used by sensitive scan
   const mockSql = opts.mockSql ?? runtime.dev.mockSql;
   const askdb = createAskDb({
     config: runtime,
     registry: ai,
     onResolve: (info) => {
       if (info.dialect.note) {
         logger.info({ event: "askdb.pipeline.dialect_override", note: info.dialect.note }, info.dialect.note);
         console.error(`Note: ${info.dialect.note}`);
       }
     },
   });
   const out = await askdb.ask(opts.question, {
     schema: { schema },
     logger,
     mode,
     explain: Boolean(opts.explain),
     omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitiveFromPrompt || undefined,
     // mock override: when opts.mockSql is set (not just runtime.dev.mockSql),
     // pass it explicitly so the --mock-sql flag still wins:
     ...(opts.mockSql !== undefined
       ? { deps: { generateText: (async () => ({ text: opts.mockSql })) as AskGenerateDeps["generateText"] } }
       : {}),
     // ...forward every other option ask() received before
   });
   // existing sensitive-SQL scan over `schema` and `out.sql` stays unchanged
   ```
   Note: when `opts.mockSql` is undefined but `runtime.dev.mockSql` is set, the
   facade already handles the mock path from config — do not double-handle.
4. Preserve the pre-flight check that errors when neither a key nor mock is
   configured, OR rely on the facade's thrown `keyMissingMessage`. Keep whichever
   the existing CLI tests assert; if a test asserts the exact pre-flight message,
   keep the pre-flight check.

**Verify**: `pnpm --filter askdb lint` → exit 0.

### Step 4: Run both host test suites and reconcile

Run `pnpm --filter @askdb/http-api test` and `pnpm --filter askdb test`.
For any test that asserted a now-deleted internal helper or an exact message that
moved, update the test to assert the **observable behavior** (HTTP status/code,
CLI stdout/stderr, returned SQL), not the internal call. Do not reduce coverage:
the dialect-precedence, mock-SQL, missing-schema, and missing-key behaviors must
still be tested at the host level.

**Verify**: both suites exit 0.

### Step 5: Changeset + full build

Create `.changeset/migrate-hosts-to-client.md`:

```md
---
"@askdb/http-api": patch
"askdb": patch
---

Resolve schema, model, and dialect via the new `@askdb/client` facade instead of duplicating the logic in each host. No behavior change: same dialect precedence, mock-SQL path, and error responses.
```

(Confirm the CLI package name for the front-matter key from `apps/cli/package.json`.)

**Verify**: `pnpm build` → exit 0.

## Test plan

- Reuse existing host tests; adapt assertions that referenced removed internals
  to observable behavior.
- Ensure these host-level behaviors remain covered (add if missing):
  - HTTP: `schemaJson` request override is honored; missing schema → 400; missing
    key (no mock) → 500 `generation_not_configured`; mock SQL → returns that SQL.
  - CLI: `--schema` path override; dialect "note" printed when config/schema
    disagree; `--mock-sql` wins over config; sensitive-SQL warning still fires.
- Verification: `pnpm --filter @askdb/http-api test` and `pnpm --filter askdb test`
  both pass.

## Done criteria

ALL must hold:

- [ ] `pnpm build` exits 0
- [ ] `pnpm --filter @askdb/http-api test` and `pnpm --filter askdb test` both exit 0
- [ ] `grep -n "resolveHttpApiDialect\|resolveSchemaJsonFromRt" apps/http-api/src/server.ts` returns no matches
- [ ] `grep -n "resolveAskDbDialect" apps/cli/src/cli.ts` returns no matches
- [ ] `grep -n "createAskDb" apps/http-api/src/server.ts apps/cli/src/cli.ts` returns a match in each
- [ ] HTTP `/ask` response shape and error codes unchanged (verified by tests)
- [ ] `git status` shows changes only within the in-scope list
- [ ] `plans/README.md` status row for 025 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The runtime config is NOT stable for the process lifetime (i.e. something
  mutates it between requests), which would make the facade's construction-time
  caching wrong for the HTTP server.
- A host needs a capability `@askdb/client` does not expose (e.g. returning the
  resolved schema object, or a resolution source the facade doesn't surface) —
  report; do not edit the facade here.
- An existing host test encodes an exact error message/format you cannot
  reproduce through the facade without changing observable behavior.
- `resolveSchemaPathWithFallbacks`'s repo-root fallback turns out to be relied on
  by a test or deployment and the facade's plain `loadSchema` can't reproduce it.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- After this lands, the only place schema/model/dialect resolution lives is
  `@askdb/client`. New hosts should depend on it rather than re-deriving.
- The HTTP server's schema cache is now the facade's internal cache — if a future
  feature needs cache invalidation (e.g. schema hot-reload), add `reload()` calls
  via the facade rather than reintroducing host-level caching.
- The CLI deliberately still loads its own schema object (for the sensitive-SQL
  scan and friendly errors) and passes it pre-loaded; if the facade later returns
  the resolved schema, the CLI can stop loading it twice.
- Reviewer should diff the HTTP `/ask` error responses before/after and confirm
  status codes and `error.code` values are byte-identical for the parse-error,
  missing-schema, and missing-key cases.

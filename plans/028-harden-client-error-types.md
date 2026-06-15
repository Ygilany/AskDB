# Plan 028: Give `@askdb/client` typed errors and restore HTTP/CLI behavior parity

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 27a20ad..HEAD -- packages/client/src/client.ts apps/http-api/src/server.ts apps/cli/src/cli.ts packages/core/src/schema/v2/loader.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes how the HTTP host maps errors to status codes; must keep existing codes for the cases that already worked)
- **Depends on**: plans/024-askdb-client-facade.md, plans/025-migrate-hosts-to-client-facade.md (both DONE — this hardens what they built)
- **Category**: bug / tech-debt
- **Planned at**: commit `27a20ad`, 2026-06-15

## Why this matters

When plan 025 migrated the HTTP API onto `@askdb/client`, it replaced typed
error handling with **string-substring matching** on `error.message` inside one
big `catch` (`apps/http-api/src/server.ts:233-287`). The facade itself throws
plain `Error`s. This produced four behavior divergences from the pre-migration
host (which plan 025 promised would be "behavior-preserving"):

1. **Missing schema *file* now returns HTTP 500 instead of 400.** `loadSchema`
   calls `statSync` *before* its own try/catch (`packages/core/src/schema/v2/loader.ts:54-55`),
   so a missing path throws a **raw `ENOENT` Error** whose message
   (`ENOENT: no such file…`) matches none of the catch's substring branches →
   falls through to `500 internal_error`. Pre-migration, any load failure was
   wrapped → `400 schema_parse_error`.
2. **`schema_parse_error` lost its source context.** Pre-migration the message
   was `schema parse error (ASKDB_SCHEMA_PATH (…)): …` (the `cachedSchemaSource`
   prefix). Now it is just `schema parse error: …`.
3. **HTTP now throws on an exotic `schema.provider`.** Pre-migration
   `resolveHttpApiDialect` defaulted an unknown provider to `"postgres"`; the
   facade's `resolveDialect` *throws*, which the catch turns into `500
   internal_error`.
4. **(CLI) The "unsupported provider" error degraded.** Pre-migration the CLI
   threw an `AskDbError` whose message ended with `Supported: <dialect list>`;
   the facade throws a terser plain `Error` with no list.

This plan makes the facade throw **typed** errors, lets the HTTP host
`instanceof`-match them (restoring exact status codes and the source prefix),
adds an opt-in graceful-dialect-fallback for the HTTP host, and restores the
rich CLI dialect message. (The repo-root relative-path fallback removed in 025 —
a separate finding — is intentionally **out of scope** here.)

## Current state

### Facade throw sites (`packages/client/src/client.ts`) — all plain `Error`

```ts
// resolveDefaultSchema — line 89
throw new Error(
  "No schema configured. Pass `schema` to createAskDb() or per-call, or set host.schemaPath / host.schemaJson in askdb.config.*.",
);

// resolveDialect — line 116 (non-built-in provider, no config dialect)
throw new Error(
  `Schema declares provider '${provider}', but AskDB ships no DialectSpec for it. Set \`dialect\` in askdb.config.* to override.`,
);

// resolveModel — line 143 (registry returns no model)
if (!model) throw new Error(registry.keyMissingMessage("NL→SQL generation"));
```

Schema loading is unwrapped (`loadFromSource`, lines 64-69): `loadSchema(path)`
and `loadSchemaFromJson(json)` propagate either `SchemaParseError` (bad JSON) or
**raw fs errors** (`ENOENT` from `statSync`/`readFileSync`).

`resolveDialect` (lines 100-123) returns `{ dialect, source, note? }`; for a
non-built-in provider with no config dialect it throws (see above) — there is no
graceful fallback option.

### Core error classes (already exported from `@askdb/core`)

`packages/core/src/errors.ts`: `AskDbError` (base) and `SchemaParseError extends
AskDbError`. Both are re-exported from `@askdb/core` (verified: `AskDbError` and
`SUPPORTED_DIALECT_IDS` are present on the package). `SUPPORTED_DIALECT_IDS` is a
`readonly string[]` of built-in dialect ids.

### HTTP catch block (`apps/http-api/src/server.ts:233-287`) — string matching

```ts
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.toLowerCase().includes("mode")) { /* 400 bad_request */ }
  if (msg.includes("No schema configured")) { /* 400 bad_request */ }
  if (msg.includes("schema parse") || msg.includes("Failed to parse") || msg.includes("SchemaParseError")) {
    /* 400 schema_parse_error, message: `schema parse error: ${msg}` */
  }
  if (msg.includes("NL→SQL generation") || msg.includes("No AI provider")) {
    /* 500 generation_not_configured */
  }
  // …then instanceof SqlValidationError (400), SqlGenerationError (502),
  //    AskDbError (500 internal_error), else 500 internal_error
}
```

The facade is built once (lazily) at `server.ts:198-206` with
`schema: optionSchemaPath ? { path: optionSchemaPath } : undefined` and no
`unknownDialect` option. The per-request call is `server.ts:216-222`
(`schema: requestOverride ? { json: requestOverride } : undefined`).

### CLI (`apps/cli/src/cli.ts`)

The CLI passes a **pre-loaded** schema (`schema: { schema }`, line 326) so the
facade never loads for the CLI — its own `loadSchemaFromPath` friendly errors are
unaffected by this plan. Dialect resolution flows through the facade; an
unsupported provider currently throws the facade's terse plain `Error`, caught at
`cli.ts:368` and printed by `printCliError` (`cli.ts:59-75`), which prints
`error.message` for a plain `Error` and `\`${error.name}: ${error.message}\``
for an `AskDbError`.

### Existing tests that must keep passing (message-preserving change)

- `packages/client/src/client.test.ts:195` — `rejects.toThrow("No schema configured")`.
- `packages/client/src/client.test.ts:206` — `rejects.toThrow("NL→SQL generation: no AI API key configured.")`.
- `apps/http-api/src/server.integration.test.ts:312` — body message contains `"No schema configured"`.
- `apps/http-api/src/server.integration.test.ts:318-342` — missing AI key → `500` / `generation_not_configured`.

Because the new typed errors keep the **same message text**, these `toThrow` /
`toContain` assertions remain valid; the change is the error *class* plus how the
host matches it.

### Conventions

- Error classes follow `packages/core/src/errors.ts`: extend `AskDbError`, set
  `this.name` to the class name in the constructor, accept an optional `cause`.
- Package uses ESM `.js` import specifiers; tests are Vitest co-located
  `*.test.ts` (see `packages/client/src/client.test.ts`).

## Commands you will need

| Purpose            | Command                                   | Expected            |
|--------------------|-------------------------------------------|---------------------|
| Build deps         | `pnpm --filter @askdb/core build`         | exit 0              |
| Client lint        | `pnpm --filter @askdb/client lint`        | exit 0              |
| Client test        | `pnpm --filter @askdb/client test`        | all pass            |
| HTTP lint          | `pnpm --filter @askdb/http-api lint`      | exit 0              |
| HTTP test          | `pnpm --filter @askdb/http-api test`      | all pass            |
| CLI lint           | `pnpm --filter askdb lint`                | exit 0              |
| CLI test           | `pnpm --filter askdb test`                | all pass            |

## Scope

**In scope**:
- `packages/client/src/errors.ts` (create)
- `packages/client/src/client.ts`
- `packages/client/src/index.ts`
- `packages/client/src/client.test.ts`
- `apps/http-api/src/server.ts`
- `apps/http-api/src/server.integration.test.ts`
- `apps/cli/src/cli.ts` (only if a test/assertion requires it — see Step 5)
- `.changeset/harden-client-errors.md` (create)

**Out of scope**:
- `packages/core/**` — do not change `loadSchema`/`SchemaParseError`; the facade
  wraps load failures, it does not modify the loader.
- The repo-root relative-path fallback (`resolveSchemaPathWithFallbacks`) removed
  in plan 025 — that is finding #4, deliberately not addressed here.
- `examples/**`, docs — no API rename, so existing docs stay correct.
- Any change to the HTTP `/ask` success response shape or to error `code` values
  for cases that already worked.

## Git workflow

- Branch: `advisor/028-harden-client-errors`
- Commit per logical unit (errors+facade, then http, then tests).
- Conventional commits, e.g. `feat(client): typed resolution errors; fix(http-api): restore status-code parity`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add typed error classes in `packages/client/src/errors.ts`

All extend `AskDbError` (from `@askdb/core`) so `printCliError` formats them and
they are `instanceof AskDbError`:

```ts
import { AskDbError } from "@askdb/core";

/** No schema source was provided or discoverable from config. */
export class SchemaNotConfiguredError extends AskDbError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaNotConfiguredError";
  }
}

/** loadSchema / loadSchemaFromJson failed (bad JSON, missing file, etc.). Carries the source it tried. */
export class SchemaLoadError extends AskDbError {
  constructor(
    readonly source: string,
    cause: unknown,
  ) {
    super(`schema load failed (${source}): ${cause instanceof Error ? cause.message : String(cause)}`, cause);
    this.name = "SchemaLoadError";
  }
}

/** schema.provider has no shipped DialectSpec and no config/override dialect was set. */
export class DialectNotSupportedError extends AskDbError {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "DialectNotSupportedError";
  }
}

/** No model override, no mock, and the registry could not build a model (missing key). */
export class ModelNotConfiguredError extends AskDbError {
  constructor(message: string) {
    super(message);
    this.name = "ModelNotConfiguredError";
  }
}
```

**Verify**: `pnpm --filter @askdb/core build && pnpm --filter @askdb/client lint`
→ exit 0 (file compiles; not yet used).

### Step 2: Throw the typed errors from the facade

In `packages/client/src/client.ts`:

1. Import the new errors and `SUPPORTED_DIALECT_IDS` from `@askdb/core`:
   ```ts
   import { /* existing… */ SUPPORTED_DIALECT_IDS } from "@askdb/core";
   import {
     DialectNotSupportedError,
     ModelNotConfiguredError,
     SchemaLoadError,
     SchemaNotConfiguredError,
   } from "./errors.js";
   ```

2. **Wrap load failures with a source label.** Change `loadFromSource` to take a
   label and wrap the loader calls:
   ```ts
   function loadFromSource(src: SchemaSource | AnyNormalizedSchema, label: string): AnyNormalizedSchema {
     if ("schemaId" in src) return src as AnyNormalizedSchema;
     if ("schema" in src) return (src as { schema: AnyNormalizedSchema }).schema;
     try {
       if ("json" in src) return loadSchemaFromJson((src as { json: string }).json);
       return loadSchema((src as { path: string }).path);
     } catch (e) {
       throw new SchemaLoadError(label, e);
     }
   }
   ```
   Update `resolveDefaultSchema` to pass a precise label per branch:
   - constructor `options.schema`: `loadFromSource(options.schema, schemaSourceLabel(options.schema))`
     where a small helper labels `{ path }` → `` `path (${p})` ``, `{ json }` →
     `"json"`, pre-loaded → `"schema"`.
   - `host.schemaJson`: label `"host.schemaJson"`; `ASKDB_SCHEMA_JSON`: label
     `"ASKDB_SCHEMA_JSON"`.
   - `host.schemaPath`: label `` `host.schemaPath (${path})` ``;
     `ASKDB_SCHEMA_PATH`: label `` `ASKDB_SCHEMA_PATH (${path})` ``.
   Update the per-call override path in `ask()`:
   `schemaOverride ? loadFromSource(schemaOverride, "request") : resolveDefaultSchema()`.

3. **Throw `SchemaNotConfiguredError`** instead of the plain `Error` in
   `resolveDefaultSchema` (keep the exact same message string).

4. **Throw `ModelNotConfiguredError`** instead of the plain `Error` in
   `resolveModel` (keep the same `registry.keyMissingMessage(...)` text).

5. **Add the `unknownDialect` option + graceful fallback** in `resolveDialect`.
   Add to `CreateAskDbOptions`:
   ```ts
   /**
    * What to do when `schema.provider` is not a built-in dialect id and no
    * config/override dialect is set. `"throw"` (default) raises
    * DialectNotSupportedError; `"fallback-postgres"` resolves to "postgres"
    * with a note (preserves the pre-migration HTTP behavior).
    */
   unknownDialect?: "throw" | "fallback-postgres";
   ```
   In `resolveDialect`, replace the plain throw with:
   ```ts
   if (provider) {
     if (!isBuiltInDialectId(provider)) {
       if (options.unknownDialect === "fallback-postgres") {
         return {
           dialect: "postgres",
           source: "default",
           note: `Schema declared provider '${provider}' with no shipped DialectSpec; defaulting to 'postgres'.`,
         };
       }
       throw new DialectNotSupportedError(
         provider,
         `Schema declares provider '${provider}', but AskDB does not yet ship a DialectSpec for it.\n` +
           `Hint: set \`dialect: "postgres"\` (or another supported id) in askdb.config.* to override. ` +
           `Supported: ${SUPPORTED_DIALECT_IDS.join(", ")}.`,
       );
     }
     return { dialect: provider, source: "schema" };
   }
   ```
   (This message matches the pre-migration CLI text — closing finding #4.)

**Verify**: `pnpm --filter @askdb/client lint` → exit 0.

### Step 3: Export the errors + option type from `packages/client/src/index.ts`

```ts
export {
  SchemaNotConfiguredError,
  SchemaLoadError,
  DialectNotSupportedError,
  ModelNotConfiguredError,
} from "./errors.js";
```
(`unknownDialect` rides on the already-exported `CreateAskDbOptions`.)

**Verify**: `pnpm --filter @askdb/client build` → exit 0; `dist/errors.js` exists.

### Step 4: Update + extend the client tests

In `packages/client/src/client.test.ts`:
- Keep the existing message assertions (they still hold) but tighten them to the
  type: `await expect(askdb.ask("q")).rejects.toBeInstanceOf(SchemaNotConfiguredError)`
  and `…toBeInstanceOf(ModelNotConfiguredError)`.
- **Add**: unsupported provider, default mode → rejects with
  `DialectNotSupportedError`; assert the message contains `Supported:` and the
  bad provider id.
- **Add**: unsupported provider, `createAskDb({ …, unknownDialect: "fallback-postgres" })`
  → resolves; capture via `onResolve` that `dialect.dialect === "postgres"` and
  `dialect.note` is set (no throw).
- **Add**: a bad schema path (e.g. `{ path: "/nope/does-not-exist.schema" }`) →
  rejects with `SchemaLoadError`; assert `err.source` contains the path.

**Verify**: `pnpm --filter @askdb/client test` → all pass (new tests included).

### Step 5: Restore typed mapping in the HTTP host

In `apps/http-api/src/server.ts`:
1. Import the typed errors:
   ```ts
   import {
     createAskDb,
     DialectNotSupportedError,
     ModelNotConfiguredError,
     SchemaLoadError,
     SchemaNotConfiguredError,
   } from "@askdb/client";
   ```
2. At facade construction (lines 198-206) add `unknownDialect: "fallback-postgres"`
   to preserve the pre-migration graceful default (closes #3).
3. Rewrite the `catch` (lines 233-287) to match types **before** the generic
   `AskDbError` branch (ordering matters — the typed errors subclass `AskDbError`):
   ```ts
   } catch (e) {
     const msg = e instanceof Error ? e.message : String(e);

     // Invalid mode id from parseAskDbModeV1 (thrown before the facade call).
     if (!(e instanceof AskDbError) && msg.toLowerCase().includes("mode")) {
       writeError(res, 400, correlationId, badRequest(correlationId, msg).error);
       return;
     }
     if (e instanceof SchemaNotConfiguredError) {
       writeError(res, 400, correlationId, {
         code: "bad_request",
         message:
           "No schema configured. Provide `schemaJson` in the request body or set ASKDB_SCHEMA_PATH / ASKDB_SCHEMA_JSON on the server.",
       });
       return;
     }
     if (e instanceof SchemaLoadError) {
       writeError(res, 400, correlationId, {
         code: "schema_parse_error",
         message: `schema parse error (${e.source}): ${e.cause instanceof Error ? e.cause.message : String(e.cause)}`,
       });
       return;
     }
     if (e instanceof ModelNotConfiguredError) {
       writeError(res, 500, correlationId, {
         code: "generation_not_configured",
         message: `${msg} (or set ASKDB_MOCK_SQL).`,
       });
       return;
     }
     logger.error({ event: AskDbLogEvent.RunError, errMessage: msg }, "askdb http run error");
     if (e instanceof SqlValidationError) { /* keep existing: 400 sql_validation_error */ }
     if (e instanceof SqlGenerationError) { /* keep existing: 502 sql_generation_error */ }
     if (e instanceof DialectNotSupportedError) {
       writeError(res, 400, correlationId, { code: "bad_request", message: msg });
       return;
     }
     if (e instanceof AskDbError) { /* keep existing: 500 internal_error */ }
     writeError(res, 500, correlationId, { code: "internal_error", message: msg });
     return;
   }
   ```
   Notes: `SchemaParseError` from core is now wrapped by the facade in
   `SchemaLoadError`, so the old `Failed to parse` substring branch is removed.
   The `DialectNotSupportedError` branch is defensive — with
   `unknownDialect: "fallback-postgres"` it should not fire, but a per-call
   override dialect could still surface one; map it to 400 rather than 500.

**Verify**: `pnpm --filter @askdb/http-api lint` → exit 0.

### Step 6: Add HTTP regression tests

In `apps/http-api/src/server.integration.test.ts`, add:
- **Missing schema file → 400 `schema_parse_error`** (closes #1): configure the
  server with a non-existent `schemaPath` (or `ASKDB_SCHEMA_PATH`), POST a valid
  question, assert `res.status === 400` and `json.error.code === "schema_parse_error"`
  and the message contains the source label (closes #2).
- **Exotic provider, no config dialect → 200, defaults to postgres** (closes #3):
  provide a `schemaJson` whose `provider` is a non-built-in id, with `ASKDB_MOCK_SQL`
  set so no live model is needed; assert `res.status === 200` and SQL returned.
  Model after the existing mock-SQL test in this file (find it via
  `grep -n "MOCK_SQL\|mockSql\|schemaJson" apps/http-api/src/server.integration.test.ts`).

**Verify**: `pnpm --filter @askdb/http-api test` → all pass (incl. new tests).

### Step 7: CLI — verify, only edit if a test requires it

The CLI needs no source change: an unsupported provider now throws
`DialectNotSupportedError` (an `AskDbError`), which `printCliError` prints as
`DialectNotSupportedError: <rich message with Supported: …>` — restoring #4.

Run `pnpm --filter askdb test`. If a CLI test asserted the *old* terse message or
the absence of a name prefix, update that test to assert the restored rich
message (contains `Supported:`) — do **not** weaken coverage. If no CLI test
references it, make no CLI change.

**Verify**: `pnpm --filter askdb lint && pnpm --filter askdb test` → exit 0, all pass.

### Step 8: Changeset

Create `.changeset/harden-client-errors.md`:

```md
---
"@askdb/client": minor
"@askdb/http-api": patch
---

`@askdb/client` now throws typed errors (`SchemaNotConfiguredError`, `SchemaLoadError`, `DialectNotSupportedError`, `ModelNotConfiguredError`) and accepts `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API matches these types to restore pre-facade behavior: a missing schema file returns 400 `schema_parse_error` (with the source in the message) instead of 500, and an unrecognized `schema.provider` falls back to `postgres` instead of erroring. The CLI's "unsupported provider" message regains the supported-dialect list.
```

**Verify**: `pnpm --filter @askdb/client test && pnpm --filter @askdb/http-api test && pnpm --filter askdb test` → all pass.

## Test plan

- New client tests: `DialectNotSupportedError` (throw mode), `fallback-postgres`
  mode resolves, `SchemaLoadError` on bad path — in `packages/client/src/client.test.ts`,
  following the existing `describe`/`it` + fake-registry pattern.
- New HTTP tests: missing-file → 400 `schema_parse_error`; exotic provider →
  200 — in `apps/http-api/src/server.integration.test.ts`.
- Regression: the four existing assertions listed in "Current state" still pass
  unchanged (message text preserved).
- Verification: all three suites green.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/client lint && pnpm --filter @askdb/client test` exit 0
- [ ] `pnpm --filter @askdb/http-api lint && pnpm --filter @askdb/http-api test` exit 0
- [ ] `pnpm --filter askdb lint && pnpm --filter askdb test` exit 0
- [ ] `grep -n "msg.includes(\"Failed to parse\")\|msg.includes(\"schema parse\")" apps/http-api/src/server.ts` returns no matches (string-matching replaced by typed checks)
- [ ] `grep -n "instanceof SchemaLoadError\|instanceof ModelNotConfiguredError\|instanceof SchemaNotConfiguredError" apps/http-api/src/server.ts` returns matches
- [ ] `grep -n "Supported:" packages/client/src/client.ts` returns a match (rich dialect message)
- [ ] New HTTP test: missing schema file asserts `400` + `schema_parse_error`; new test: exotic provider asserts `200`
- [ ] `git status` shows changes only within the in-scope list
- [ ] `plans/README.md` status row for 028 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift since `27a20ad`).
- Making the typed errors `instanceof AskDbError` breaks an existing HTTP/CLI
  test in a way that can't be fixed by reordering the catch (e.g. a test depends
  on a parse error being `500`).
- `loadSchema` no longer throws `ENOENT` synchronously (loader changed) — the
  missing-file regression test premise would be wrong.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The HTTP catch now relies on `@askdb/client` error *types*, not message text —
  keep the typed branches ordered before the generic `AskDbError` branch (the
  facade errors subclass it). Any new facade error type needs a host branch.
- `unknownDialect` defaults to `"throw"` so the CLI (and any new host) surfaces
  misconfiguration loudly; only the HTTP host opts into `"fallback-postgres"` for
  backward compatibility. If a future product decision prefers strictness, drop
  the HTTP opt-in (and update its tests).
- The repo-root relative-path fallback removed in plan 025 (finding #4) is still
  unaddressed — if a deployment reports a relative `ASKDB_SCHEMA_PATH` no longer
  resolving, that is the follow-up, not this plan.
- Reviewer should confirm the four pre-existing assertions still pass unchanged
  and that no error `code` value changed for a case that already worked.

# Plan 032: Unify Studio execute with the engine packages so per-provider knowledge has one home (incl. SQL Server TLS fix)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2865cff..HEAD -- packages/postgres/src/exec packages/mysql/src/exec packages/sqlite/src/exec packages/sqlserver/src/exec packages/postgres/src/index.ts packages/mysql/src/index.ts packages/sqlite/src/index.ts packages/sqlserver/src/index.ts apps/studio/src/execute-registry.ts apps/studio/package.json`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug + tech-debt
- **Planned at**: commit `2865cff`, 2026-06-26

## Why this matters

Plan 030 made `apps/studio/src/execute-registry.ts` the second implementation of "load an optional database driver and execute a query" in the repo. The first lives in each `@askdb/<engine>` package under `src/exec/<engine>.ts`. The two implementations have already drifted: the SQL Server connection-string normalization that shipped in commit e6caf41 (`packages/sqlserver/src/exec/sqlserver.ts:93` — `resolveConnectionInput`) reached the engine package and the introspect path but did NOT reach studio's execute path — producing a `Failed to connect to localhost:1433 - self-signed certificate` failure for users whose ADO.NET connection string uses the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default).

The structural problem is wider than the SQL Server bug:

- Driver-loading logic (`isModuleResolutionFailure` + lazy `import()` with `createRequire(process.cwd())` fallback) is duplicated four times in the engine packages and again, with `projectRoot` substituted for `process.cwd()`, in `apps/studio/src/execute-registry.ts`.
- Connection-string handling is owned by `@askdb/sqlserver` (via `resolveConnectionInput`) but **bypassed** by studio. If MySQL or Postgres ever need similar normalization (e.g. mysql2's varying SSL-mode keys, Postgres's `sslmode=` vs `ssl=true`), the same drift will recur.
- Read-only enforcement (`BEGIN READ ONLY` / `SET SESSION TRANSACTION READ ONLY` / `readonly: true`) is implemented separately in each place, and the two paths already differ slightly in their MySQL handling.
- The `isDriverInstalled(packageName, projectRoot)` precheck in studio is the only good thing that the engine packages currently lack — the engine packages can throw a friendly error when the driver is missing, but they cannot tell you *in advance*.

This plan does the durable fix: it moves the per-provider knowledge into the engine packages, behind a single `resolveFrom` option, and turns studio's `execute-registry.ts` into a thin coordinator that owns only studio-specific concerns (result truncation, timing, SQL Server placeholder rewriting, the install-prompt UX). The SQL Server TLS regression is closed as a transitive consequence — studio's `executeSQLServer` will route through `resolveConnectionInput` because the engine package owns that call. After this, the surface area for the next "studio works, introspect doesn't" — or vice versa — bug is gone for all four providers.

## Current state

### Topology

```
@askdb/introspect       (engine-agnostic; exports CatalogQueryRunner type)
   ↑ (types only)
   ├── @askdb/postgres   exec/postgres.ts → createPostgresCatalogQueryRunner(url)
   │                                        ├── loadPgOrThrow (cwd fallback)
   │                                        └── runs BEGIN READ ONLY
   ├── @askdb/mysql      exec/mysql.ts    → createMysqlCatalogQueryRunner(url)
   ├── @askdb/sqlite     exec/sqlite.ts   → createSqliteCatalogQueryRunner(file)
   └── @askdb/sqlserver  exec/sqlserver.ts → createSqlServerCatalogQueryRunner(url)
                                            └── resolveConnectionInput  ← internal, not exported from barrel
@askdb/connectors        registry; consumers register engine providers
apps/cli                 imports all 4 engine packages → CatalogQueryRunner path
apps/studio              re-implements driver load + execute per provider
                         in src/execute-registry.ts; projectRoot, not cwd
                         studio-specific: placeholder rewrite ($1→@p0), truncation, timing
                         BYPASSES resolveConnectionInput → TLS regression
```

### Files in play

- `packages/postgres/src/exec/postgres.ts` — pattern reference for the engine-package side of this plan.
- `packages/mysql/src/exec/mysql.ts`
- `packages/sqlite/src/exec/sqlite.ts`
- `packages/sqlserver/src/exec/sqlserver.ts` — already contains `resolveConnectionInput` (commit e6caf41) but does NOT export it from the package barrel.
- Each package's `src/index.ts` barrel.
- `apps/studio/src/execute-registry.ts` — the surface to thin out.
- `apps/studio/package.json` — currently lists `@askdb/postgres` (dead dep, never imported); needs the four `@askdb/<engine>` deps active and load-bearing.
- `apps/studio/src/server.ts:1141-1215` (`getExecuteStatus` / `installExecuteDriver` / `executeQuery`) — calls the registry; payload contract must remain identical.
- `apps/studio/src/server.test.ts` — assertions on the status response are the contract for the public-facing shape; new tests must keep these passing.

### Excerpts (skim — full text in the in-scope files)

`packages/sqlserver/src/exec/sqlserver.ts:69-106` defines the SQL Server connection-string helper (already exported from the file; needs to be re-exported from the barrel):

```ts
type MssqlConfigInput = {
  server: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  options?: { encrypt?: boolean; trustServerCertificate?: boolean };
};

/**
 * mssql v12 uses @tediousjs/connection-string v1.x, which has two known gaps: …
 */
export function resolveConnectionInput(connectionString: string): string | MssqlConfigInput {
  if (connectionString.startsWith("mssql://")) {
    return parseMssqlSchemeUrl(connectionString);
  }
  if (connectionString.startsWith("sqlserver://")) {
    return parsePrismaSqlServerUrl(connectionString);
  }
  if (!connectionString.includes("://")) {
    return normalizeAdoNetString(connectionString);
  }
  return connectionString;
}
```

`packages/sqlserver/src/index.ts` (full barrel — `resolveConnectionInput` and its return-type are absent):

```ts
export {
  createSqlServerCatalogQueryRunner,
  type CatalogQueryResult,
  type CatalogQueryRunner,
} from "./exec/sqlserver.js";

export { sqlServerConnectorProvider } from "./connector/provider.js";
```

The driver-loader shape that's repeated four times in `packages/*/src/exec/*.ts` (Postgres shown; mysql/sqlite/sqlserver are line-for-line analogues):

```ts
// packages/postgres/src/exec/postgres.ts
let pgModulePromise: Promise<typeof import("pg")> | undefined;

async function importOptionalPg(): Promise<typeof import("pg")> {
  try {
    return await import("pg");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "pg")) throw cause;
    const projectRequire = createRequire(join(process.cwd(), "package.json"));   // ← cwd only
    try {
      const resolved = projectRequire.resolve("pg");
      return (await import(pathToFileURL(resolved).href)) as typeof import("pg");
    } catch (projectCause) {
      …
      throw new AggregateError([cause, projectCause], "Unable to resolve optional `pg` peer dependency");
    }
  }
}
```

Studio's near-duplicate (`apps/studio/src/execute-registry.ts:45-77`):

```ts
function resolveDriverPath(packageName: string, projectRoot: string): string | null {
  try {
    const req = createRequire(join(projectRoot, "__stub__.js"));   // ← projectRoot
    return req.resolve(packageName);
  } catch { return null; }
}

async function importDriver(packageName: string, projectRoot: string): Promise<unknown> {
  const resolved = resolveDriverPath(packageName, projectRoot);
  if (resolved) return import(pathToFileURL(resolved).href);
  return import(packageName);
}
```

Studio's SQL Server executor (`apps/studio/src/execute-registry.ts:288-326`) — the line that bypasses `resolveConnectionInput`:

```ts
async function executeSQLServer(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  …
  let mssqlMod: MssqlMod;
  try {
    const mod = await importDriver("mssql", projectRoot);
    mssqlMod = ((mod as unknown as { default?: MssqlMod }).default ?? mod) as MssqlMod;
  } catch {
    return { ok: false, error: "The `mssql` package is not installed. Install it with `pnpm add mssql`." };
  }
  …
  pool = await new mssqlMod.ConnectionPool(connectionString).connect();   // ← raw string; TLS bug
  …
}
```

Per-provider executors in studio that bypass everything in the engine package (`apps/studio/src/execute-registry.ts:118-326`): four `executeXxx()` functions, ~25 lines each, each importing the driver via `importDriver(...)` and constructing/closing the connection inline.

The connector-provider wiring already in the engine packages — for example `packages/sqlserver/src/connector/provider.ts`:

```ts
export const sqlServerConnectorProvider: ConnectorProviderAdapter = {
  provider: "sqlserver",
  createConnector(config: ConnectorConfig): ConnectorResult {
    if (!config.url) throw new Error("SQL Server connector requires a connection URL (config.url).");
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createSqlServerCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createSqlServerConnector() as Connector<unknown>,
    };
  },
};
```

The studio response contract that must NOT change (`apps/studio/src/shared/api.ts` — `ExecuteResponse`):

```ts
type ExecuteResponse =
  | { ok: true; columns: string[]; rows: unknown[][]; rowCount: number; durationMs: number; truncated: boolean }
  | { ok: false; error: string };
```

### Repo conventions that apply

- Engine packages keep their `loadXxxOrThrow` cache + `__resetXxxModuleCacheForTests` accessor. New options must not break those tests.
- `CatalogQueryRunner` from `@askdb/introspect` is `(sql, params) => Promise<{columns, rows}>`. Studio needs more (timing/truncation/rowCount) — those are computed in studio, not pushed into the runner contract.
- Tests for each engine's driver-loading live as `*.lazy.test.ts` (`packages/<engine>/src/exec/<engine>.lazy.test.ts`). Follow that name when adding `resolveFrom` coverage.
- The connector-provider wiring is the existing extensibility seam between consumers and engines; prefer reusing it over inventing a new one.
- pnpm workspace; workspace deps are spelled `"workspace:*"`. Keep `dependencies` blocks alphabetical (see `apps/studio/package.json:48-60`).
- ESM-only; `from "@askdb/sqlserver"`, `.js` suffix only on relative imports.
- Test files live next to source as `*.test.ts` and use `vitest`. The test command in every package is `vitest run --config ../../vitest.config.ts`.
- Public type re-exports in barrels use `export type { … }`.

## Commands you will need

| Purpose                       | Command                                                                              | Expected on success                  |
|-------------------------------|--------------------------------------------------------------------------------------|--------------------------------------|
| Install (after pkg changes)   | `pnpm install`                                                                       | exit 0                               |
| Type-check a package          | `pnpm -C packages/<name> lint`                                                       | exit 0                               |
| Type-check studio             | `pnpm -C apps/studio lint`                                                           | exit 0                               |
| Test a single engine package  | `pnpm -C packages/<name> test`                                                       | all pass                             |
| Test studio                   | `pnpm -C apps/studio test`                                                           | all pass                             |
| Build a package               | `pnpm -C packages/<name> build`                                                      | exit 0                               |
| Build studio                  | `pnpm -C apps/studio build`                                                          | exit 0                               |
| Full repo                     | `pnpm test && pnpm lint`                                                             | both exit 0                          |

## Scope

**In scope:**

- `packages/sqlserver/src/exec/sqlserver.ts` — export the `MssqlConfigInput` type (currently file-internal); optional cleanup of the `as never` cast on line 208.
- `packages/postgres/src/exec/postgres.ts`, `packages/mysql/src/exec/mysql.ts`, `packages/sqlite/src/exec/sqlite.ts`, `packages/sqlserver/src/exec/sqlserver.ts` — add a `resolveFrom?: string` option to each driver loader so callers can override the `cwd` fallback. Public surface change is small (new optional parameter to the existing factory; see Step 1).
- `packages/postgres/src/index.ts`, `packages/mysql/src/index.ts`, `packages/sqlite/src/index.ts`, `packages/sqlserver/src/index.ts` — re-export new `loadXxxDriver()` and `isXxxDriverInstalled()` helpers; in the sqlserver barrel, also re-export `resolveConnectionInput` and `MssqlConfigInput` (see Step 2).
- `packages/<each>/src/exec/<each>.lazy.test.ts` — extend coverage to confirm `resolveFrom` is honored.
- `apps/studio/package.json` — add `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver` to `dependencies` (postgres is already listed but currently dead; this plan makes it actually load-bearing).
- `apps/studio/src/execute-registry.ts` — replace `importDriver`/`resolveDriverPath` with calls into the engine packages' new helpers; route `executeSQLServer` through `resolveConnectionInput`. Each `executeXxx()` continues to own placeholder rewriting, timing, and truncation but no longer owns driver loading or connection-string parsing.
- `apps/studio/src/execute-registry.unified.test.ts` (new) — tests that prove the wiring and the SQL Server TLS regression is closed.
- `.changeset/<new-file>.md` — minor bumps for the four engine packages (new public helpers + sqlserver's `resolveConnectionInput` export) and a patch for `@askdb/studio` (bug fix + internal refactor).

**Out of scope** (do NOT touch, even though they look related):

- Any change to `@askdb/introspect`, `@askdb/connectors`, `@askdb/core`, or the connector-provider adapters in `packages/*/src/connector/provider.ts`. Their boundary is already correct.
- Any change to `apps/cli/src/introspect.ts` — the CLI's introspect path already uses `createXxxCatalogQueryRunner` and is unaffected.
- The studio install-prompt endpoint (`apps/studio/src/server.ts:1162-1215` `installExecuteDriver`) — its only dependency on the registry is the `packageName` field, which stays. Do not refactor it.
- Any change to studio's web/React code — the registry interface stays.
- Combining `CatalogQueryRunner` with studio's `ExecuteResponse` shape — they have different concerns. Keep them distinct.
- SQL placeholder normalization across engines (e.g. teaching `@askdb/core` to emit dialect-correct placeholders so studio's `rewriteSqlServerParams` becomes unnecessary). That's a worthy follow-up but a different change.
- `packages/sqlserver/src/exec/sqlserver.ts` parsing internals (`parseMssqlSchemeUrl`, `parsePrismaSqlServerUrl`, `normalizeAdoNetString`, `ADO_NET_KEY_NORMALISATIONS`) — already tested; do not refactor.

## Git workflow

- Branch: `advisor/032-unify-studio-execute-with-engine-packages`.
- Suggested commit boundary: one per step. Conventional-commits style; e.g.
  `refactor(engines): add resolveFrom option to driver loaders`
  `feat(engines): expose loadXxxDriver/isXxxDriverInstalled + sqlserver resolveConnectionInput from barrels`
  `refactor(studio): delegate driver loading to engine packages; fix SQL Server TLS via resolveConnectionInput`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Add `resolveFrom` to each engine package's driver loader

For each of `packages/{postgres,mysql,sqlite,sqlserver}/src/exec/<engine>.ts`:

1. Refactor `importOptionalXxx` and `loadXxxOrThrow` to accept an `options: { resolveFrom?: string }` argument. When `resolveFrom` is provided, use it instead of `process.cwd()` for the `createRequire(...)` fallback. When absent, behavior is unchanged.

   Target signature (Postgres example):

   ```ts
   async function importOptionalPg(opts?: { resolveFrom?: string }): Promise<typeof import("pg")> {
     try { return await import("pg"); }
     catch (cause) {
       if (!isModuleResolutionFailure(cause, "pg")) throw cause;
       const fromDir = opts?.resolveFrom ?? process.cwd();
       const projectRequire = createRequire(join(fromDir, "package.json"));
       …
     }
   }

   async function loadPgOrThrow(opts?: { resolveFrom?: string }): Promise<typeof import("pg")> { … }
   ```

2. Thread `resolveFrom` through `runXxxCatalogQuery` and `createXxxCatalogQueryRunner`. The factory's new signature:

   ```ts
   export function createPostgresCatalogQueryRunner(
     connectionString: string,
     options?: { resolveFrom?: string },
   ): CatalogQueryRunner { … }
   ```

   Existing callers pass nothing; behavior unchanged. New callers (studio, embedders that run from a different cwd than the user project) pass `{ resolveFrom: projectRoot }`.

3. Adjust the module-promise cache so that the cached promise is **per `resolveFrom`** — otherwise the first cwd-only call would poison the cache for a later `resolveFrom`-specific call. A `Map<string | undefined, Promise<…>>` keyed on `resolveFrom` is sufficient. On a failed import, delete only that key from the map so unrelated cached drivers remain valid. Update `__resetXxxModuleCacheForTests()` to clear the whole map.

   STOP and report (per the conditions below) if any existing test depends on the singular-promise shape in a way that can't be mapped to the Map — the existing `.lazy.test.ts` files use the reset helper and should be unaffected.

4. **`@askdb/sqlserver` only**: the new `resolveFrom` flows through to `loadMssqlOrThrow`. The `resolveConnectionInput` helper does not change.

**Verify** (run for each of the four packages):
- `pnpm -C packages/<name> lint` → exit 0
- `pnpm -C packages/<name> test` → all existing tests pass (cache changes haven't regressed `*.lazy.test.ts`)

### Step 2: Expose public helpers from each engine package barrel

In `packages/sqlserver/src/exec/sqlserver.ts`:

- Change `type MssqlConfigInput = { … }` (currently line 69) to `export type MssqlConfigInput = { … }`. No body changes.
- Optional but low priority: line 208 currently uses `as never` because the `mssql` constructor types are awkward around `string | config-object` inputs. Prefer leaving this alone unless a cleaner cast compiles without changing behavior. If you do clean it up, the acceptable target is a cast to the constructor's accepted input type (for example a local alias), not `string & MssqlConfigInput`.

  Current code:
  ```ts
  const pool = new mssql.ConnectionPool(resolveConnectionInput(connectionString) as never);
  ```

In each `packages/<engine>/src/exec/<engine>.ts`, add a new exported function whose only purpose is to load (and cache) the driver — separate from running a catalog query. This is what studio will call instead of its own `importDriver`.

Shape (Postgres example):

```ts
type PgDriverModule = typeof import("pg");

/**
 * Resolve and cache the optional `pg` peer driver, with the same lazy-import
 * + project-root fallback behavior as the catalog runner. Exposed for embedders
 * (e.g. `@askdb/studio`'s execute registry) that need direct driver access for
 * UI-layer concerns like timing, truncation, or SQL placeholder rewriting.
 *
 * Throws an AskDbError with install hints when the peer is missing.
 */
export async function loadPgDriver(
  options?: { resolveFrom?: string },
): Promise<PgDriverModule> {
  const mod = await loadPgOrThrow(options);
  return (mod as unknown as { default?: PgDriverModule }).default ?? mod;
}
```

Apply the same "normalized runtime module" rule to the other loaders: `loadMysql2Driver()` should return the object with `createConnection` directly usable, and `loadMssqlDriver()` should return the object with `ConnectionPool` directly usable. This keeps CJS/ESM interop in the engine packages instead of moving that per-driver knowledge into studio. For sqlite, the type alias is `Bs3Namespace`; export it alongside so consumers don't have to re-derive it, and `loadBetterSqlite3Driver()` can return that namespace because the constructor is intentionally under `.default` in the current type model.

Also add a synchronous `isXxxDriverInstalled` helper next to each loader, mirroring the check studio currently does in `resolveDriverPath`:

```ts
export function isPgDriverInstalled(options?: { resolveFrom?: string }): boolean {
  try {
    const req = createRequire(join(options?.resolveFrom ?? process.cwd(), "package.json"));
    req.resolve("pg");
    return true;
  } catch { return false; }
}
```

Names: `isPgDriverInstalled`, `isMysql2DriverInstalled`, `isBetterSqlite3DriverInstalled`, `isMssqlDriverInstalled`.

Specifier detail: `isMysql2DriverInstalled()` should check `req.resolve("mysql2")`, matching studio's current install-readiness package name. `importOptionalMysql2()` / `loadMysql2Driver()` should continue to resolve/import `"mysql2/promise"` for execution.

Add the new exports to each `src/index.ts` barrel. The sqlserver barrel additionally re-exports `resolveConnectionInput` and `MssqlConfigInput`:

```ts
// packages/sqlserver/src/index.ts (final block)
export {
  createSqlServerCatalogQueryRunner,
  loadMssqlDriver,
  isMssqlDriverInstalled,
  resolveConnectionInput,
  type CatalogQueryResult,
  type CatalogQueryRunner,
  type MssqlConfigInput,
} from "./exec/sqlserver.js";
```

**Verify**:
- `pnpm -C packages/<name> lint` for each → exit 0
- `grep -n "loadPgDriver\|loadMysql2Driver\|loadBetterSqlite3Driver\|loadMssqlDriver" packages/*/src/index.ts` shows one match per engine.
- `grep -n "resolveConnectionInput" packages/sqlserver/src/index.ts` shows one match.

### Step 3: Add `resolveFrom` test coverage to the engine packages

Extend `packages/<name>/src/exec/<name>.lazy.test.ts` (or add a sibling `*.resolve-from.test.ts` if the existing file is hard to extend) with three cases per package:

1. `resolveFrom: <dir without the driver in node_modules>` plus the absence of a top-level resolvable driver → throws the existing `AskDbError` with the install hint message. (Mock or set up a temp dir as needed; follow the pattern in the existing `*.lazy.test.ts`.)
2. `resolveFrom: <dir with a fixture driver in node_modules>` succeeds even when `process.cwd()` points somewhere else and the bare specifier mock fails.
3. Two separate `resolveFrom` directories use independent cache slots (calling with `resolveFrom: "/a"` does not satisfy a later call with `resolveFrom: "/b"` if `/a` had a driver and `/b` does not).

The current `*.lazy.test.ts` files mock `node:module` with `createRequire: () => ({ resolve(...) { ... } })`, ignoring the path passed to `createRequire`. To test `resolveFrom` correctly, update that mock to accept the filename argument and resolve from a map keyed by `dirname(filename)` (or by the exact `join(resolveFrom, "package.json")` / stub path you choose). Avoid a single global `projectResolvedPath`; it cannot prove that the loader used the caller's `resolveFrom`.

If the existing `.lazy.test.ts` is heavily reliant on the singular module-cache shape and adapting it is awkward, write the new cases as a sibling file rather than rewriting the original.

**Verify**: `pnpm -C packages/<name> test` → all pass; the new `resolveFrom` cases appear in the output per package.

### Step 4: Add the missing engine deps to studio

Edit `apps/studio/package.json` `dependencies` (alphabetically positioned):

```json
"@askdb/mysql": "workspace:*",
…
"@askdb/postgres": "workspace:*",
…
"@askdb/sqlite": "workspace:*",
"@askdb/sqlserver": "workspace:*",
```

Postgres is already listed but never imported (pre-existing dead dep from before plan 030). After this plan all four are live. If you prefer to remove the dead listing rather than reuse it, that's fine too — but you'll still need to add it back load-bearing in Step 5, so leaving it in is simpler.

Run `pnpm install` from the repo root. Lockfile updates expected.

**Verify**:
- `pnpm install` → exit 0
- `pnpm -C apps/studio lint` → exit 0 (no broken imports yet; this step only adds deps).

### Step 5: Replace studio's driver loading with the engine-package helpers; close the TLS bug

In `apps/studio/src/execute-registry.ts`:

1. Delete `resolveDriverPath` and `importDriver` (lines 45-77 in the current file). They are about to be obsolete.

2. Replace the top-of-file imports with the engine-package surfaces:

   ```ts
   import { loadPgDriver, isPgDriverInstalled } from "@askdb/postgres";
   import { loadMysql2Driver, isMysql2DriverInstalled } from "@askdb/mysql";
   import { loadBetterSqlite3Driver, isBetterSqlite3DriverInstalled } from "@askdb/sqlite";
   import {
     loadMssqlDriver,
     isMssqlDriverInstalled,
     resolveConnectionInput,
     type MssqlConfigInput,
   } from "@askdb/sqlserver";
   ```

3. Replace `isDriverInstalled` (lines 363-372) so it delegates to the engine packages:

   ```ts
   export function isDriverInstalled(packageName: string, projectRoot: string): boolean {
     switch (packageName) {
       case "pg":               return isPgDriverInstalled({ resolveFrom: projectRoot });
       case "mysql2":           return isMysql2DriverInstalled({ resolveFrom: projectRoot });
       case "better-sqlite3":   return isBetterSqlite3DriverInstalled({ resolveFrom: projectRoot });
       case "mssql":            return isMssqlDriverInstalled({ resolveFrom: projectRoot });
       default:                 return false;
     }
   }
   ```

4. Rewrite each `executeXxx()` so it calls `loadXxxDriver({ resolveFrom: projectRoot })` instead of `importDriver(packageName, projectRoot)`. The per-provider executor's body shrinks to:
   - load the driver (delegated; engine package owns the lazy-import + cache + helpful error)
   - apply any provider-specific connection-string normalization (only SQL Server today, via `resolveConnectionInput`)
   - construct/use/close the connection (still studio's job)
   - rewrite placeholders if applicable (SQL Server only — keep `rewriteSqlServerParams`)
   - apply read-only enforcement (keep — distinct per provider; studio's existing patterns are correct)
   - normalize the result and apply truncation/timing via `buildOkResponse` (keep)

5. **SQL Server specifically (closes the TLS bug):** widen the local `MssqlMod` shape so the constructor accepts both a string and the config object:

   ```ts
   type MssqlMod = {
     ConnectionPool: new (
       config: string | MssqlConfigInput,
     ) => MssqlPool & { connect(): Promise<MssqlPool> };
   };
   ```

   And rewrite the load+connect lines in `executeSQLServer` (currently 288-307) from:

   ```ts
   const mod = await importDriver("mssql", projectRoot);
   const mssqlMod = ((mod as unknown as { default?: MssqlMod }).default ?? mod) as MssqlMod;
   …
   pool = await new mssqlMod.ConnectionPool(connectionString).connect();
   ```

   to:

   ```ts
   const mssqlMod = await loadMssqlDriver({ resolveFrom: projectRoot });
   …
   pool = await new mssqlMod.ConnectionPool(resolveConnectionInput(connectionString)).connect();
   ```

   The `.default` unwrap moves into the engine package's public `loadXxxDriver()` helpers (it's the same ESM/CJS interop the engine packages already handle for the catalog runners). The `resolveConnectionInput` call is what closes the user-reported `Failed to connect to localhost:1433 - self-signed certificate` regression; nothing else in `executeSQLServer` needs to change.

6. Map the engine package's `AskDbError` (thrown when the driver is missing) into the existing `{ ok: false, error: … }` shape:

   ```ts
   try {
     mssqlMod = await loadMssqlDriver({ resolveFrom: projectRoot });
   } catch (err) {
     // engine package already produces a helpful "install with pnpm add mssql" message
     return { ok: false, error: err instanceof Error ? err.message : String(err) };
   }
   ```

   This is a behavior change in the missing-driver error text — for the better. Capture the previous text in a test if you want a regression record.

**Verify**:
- `pnpm -C apps/studio lint` → exit 0
- `! grep -En "createRequire|pathToFileURL" apps/studio/src/execute-registry.ts` → exit 0 / zero matches
- `! grep -En "importDriver|resolveDriverPath" apps/studio/src/execute-registry.ts` → exit 0 / zero matches
- `! grep -En "new mssqlMod\\.ConnectionPool\\(connectionString\\)" apps/studio/src/execute-registry.ts` → exit 0 / zero matches (raw-string path removed)
- `grep -En "resolveConnectionInput" apps/studio/src/execute-registry.ts` → exactly one match (inside `executeSQLServer`)
- `pnpm -C apps/studio test` → all existing tests pass.

### Step 6: Add unification + TLS regression tests

New tests in `apps/studio/src/execute-registry.unified.test.ts`. Use `vi.mock("@askdb/postgres", …)` etc. with recording fakes (or `vi.mock("mssql", …)` for the TLS test); no live databases required.

Required cases:

1. **All four providers route their driver load through the engine package.** Mock each `loadXxxDriver` and drive each provider via `EXECUTE_DRIVER_REGISTRY.<provider>.execute(...)` with a stub connection string; assert each mock was called with `{ resolveFrom: <the projectRoot you passed> }`.

2. **`isDriverInstalled` delegates per-provider.** Mock the four `isXxxDriverInstalled` exports and verify `isDriverInstalled("pg", "/x")` calls `isPgDriverInstalled({ resolveFrom: "/x" })`, etc.

3. **SQL Server execute applies `resolveConnectionInput` — spaced ADO.NET key normalized before `ConnectionPool` sees it.**
   - Input: `Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;Encrypt=True;Trust Server Certificate=True;`
   - Mock `@askdb/sqlserver`'s `loadMssqlDriver` with a recording `ConnectionPool` constructor. If Vitest module-mock semantics make that brittle, use the STOP-condition fallback below and mock `mssql` directly.
   - Expect captured value to contain `TrustServerCertificate=True` and **not** match `/Trust\s+Server\s+Certificate/i`.

4. **SQL Server execute — `mssql://` URL converted to a config object.**
   - Input: `mssql://appuser:Str0ngP4ss@db.example.com:1433/AppCatalog?trustServerCertificate=true`
   - Expect captured value to be an object with `server === "db.example.com"`, `port === 1433`, `database === "AppCatalog"`, `options.trustServerCertificate === true`.

5. **SQL Server execute — pass-through identity for plain ADO.NET strings with no affected keys.**
   - Input: `Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;`
   - Expect captured value `=== input` (string identity).

For case 1, the driver mocks must provide enough behavior for the execute function to finish without a live database: Postgres needs `Client.connect/query/end`, MySQL needs `createConnection().query/execute/end`, SQLite needs a constructor with `prepare().columns/all` and `close`, and SQL Server needs `ConnectionPool.connect/request/close`. The public helper mocks should return the normalized runtime shape described in Step 2 — for example `loadMssqlDriver` returns `{ ConnectionPool }`, not only `{ default: { ConnectionPool } }`.

Scaffolding sketch for case 3 (mirror existing `apps/studio/src/server.test.ts` style for setup conventions):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: { config: unknown } = { config: undefined };

vi.mock("@askdb/sqlserver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/sqlserver")>();
  return {
    ...actual,
    loadMssqlDriver: async () => {
      class ConnectionPool {
        constructor(config: unknown) { captured.config = config; }
        connect() { return Promise.resolve(this); }
        request() {
          return { input() { return this; }, async query() { return { recordset: [] }; } };
        }
        close() { return Promise.resolve(); }
      }
      return { ConnectionPool };
    },
  };
});

import { EXECUTE_DRIVER_REGISTRY } from "./execute-registry.js";

describe("studio sqlserver execute applies resolveConnectionInput", () => {
  beforeEach(() => { captured.config = undefined; });

  it("normalizes spaced ADO.NET TrustServerCertificate key", async () => {
    const cs =
      "Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;" +
      "Encrypt=True;Trust Server Certificate=True;";
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: cs, sql: "SELECT 1", params: [], projectRoot: process.cwd(),
    });
    expect(typeof captured.config).toBe("string");
    expect(captured.config).toContain("TrustServerCertificate=True");
    expect(captured.config as string).not.toMatch(/Trust\s+Server\s+Certificate/i);
  });
  // …cases 4 and 5 follow the same shape
});
```

**Verify**: `pnpm -C apps/studio test` → all pass; the five new `it(...)`s appear in the output.

### Step 7: Changeset + final pass

Create `.changeset/032-unify-studio-execute.md`. Look at any existing file in `.changeset/` for the exact header format used in this repo; body along the lines of:

```md
---
"@askdb/postgres": minor
"@askdb/mysql": minor
"@askdb/sqlite": minor
"@askdb/sqlserver": minor
"@askdb/studio": patch
---

**@askdb/{postgres,mysql,sqlite,sqlserver}**: Driver loaders (`createXxxCatalogQueryRunner`) now accept a `resolveFrom?: string` option for embedders that need to resolve the optional native peer from a directory other than `process.cwd()` (e.g. `@askdb/studio` running from an npx cache while the user project sits elsewhere). New `loadXxxDriver` and `isXxxDriverInstalled` helpers are exported for the same reason. `@askdb/sqlserver` additionally re-exports `resolveConnectionInput` and the `MssqlConfigInput` type so embedders can apply the same connection-string normalization the catalog runner uses. Behavior with no option / no helper import is unchanged.

**@askdb/studio**: SQL Server query execution now routes the connection string through `@askdb/sqlserver`'s `resolveConnectionInput` before constructing the `mssql.ConnectionPool`. Fixes `Failed to connect to localhost:1433 - self-signed certificate` failures on ADO.NET connection strings that use the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default), and adds support for `mssql://` and Prisma-style `sqlserver://` URLs — matching the introspect path. Internal: the execute registry now delegates driver loading and per-engine connection-string normalization to the `@askdb/<engine>` packages instead of re-implementing them, eliminating the drift surface that caused the TLS regression in the first place.
```

Run the full local gates:

- `pnpm install`
- `pnpm lint`
- `pnpm test`
- `pnpm -C apps/studio build`
- `pnpm -C packages/postgres build && pnpm -C packages/mysql build && pnpm -C packages/sqlite build && pnpm -C packages/sqlserver build`

All must exit 0.

## Test plan

Per-package additions (Step 3) — three cases per engine in `*.lazy.test.ts` or a sibling:

- `resolveFrom` missing-driver path: when the bare specifier is not resolvable and `resolveFrom` points at a dir without the driver, the loader rejects with the existing helpful `AskDbError`.
- `resolveFrom` honored: when the bare specifier is not resolvable and `resolveFrom` points at a dir that DOES have the driver in `node_modules`, the loader succeeds.
- Cache slot per `resolveFrom`: independent slots; reset helper clears all slots.

Studio additions (Step 6) — `apps/studio/src/execute-registry.unified.test.ts`:

| Case                                             | Pass condition                                                                        |
|--------------------------------------------------|---------------------------------------------------------------------------------------|
| Driver delegation per provider (4 cases)         | `loadXxxDriver` called with `{ resolveFrom: <projectRoot> }`                          |
| `isDriverInstalled` delegation per provider (4)  | `isXxxDriverInstalled` called with `{ resolveFrom: <projectRoot> }`                   |
| Spaced ADO.NET TLS key normalized                | captured `ConnectionPool` arg contains `TrustServerCertificate=True`; no spaced form  |
| `mssql://` URL → config object                   | captured arg is object with `server`/`port`/`database` set, `options.trustServerCertificate === true` |
| Pass-through identity                            | captured arg === input (string identity)                                              |

Pattern source: `packages/sqlserver/src/exec/sqlserver.url.test.ts` for SQL Server input/expectation pairs; `apps/studio/src/server.test.ts` for studio test scaffolding style; the existing `*.lazy.test.ts` files for engine-loader test setup.

Full verification: `pnpm test` exits 0 with all new cases visible.

## Done criteria

ALL must hold:

- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0; the new engine-package `resolveFrom` cases and the studio unification/TLS cases all pass
- [ ] `pnpm -C apps/studio build` and the four `pnpm -C packages/<engine> build` all exit 0
- [ ] `! grep -En "createRequire|pathToFileURL" apps/studio/src/execute-registry.ts` exits 0 (zero matches)
- [ ] `! grep -En "importDriver|resolveDriverPath" apps/studio/src/execute-registry.ts` exits 0 (zero matches)
- [ ] `! grep -En "new mssqlMod\\.ConnectionPool\\(connectionString\\)" apps/studio/src/execute-registry.ts` exits 0 (zero matches; raw-string path removed)
- [ ] `grep -n "resolveConnectionInput" apps/studio/src/execute-registry.ts` returns exactly one match (inside `executeSQLServer`)
- [ ] `grep -rn "loadPgDriver\|loadMysql2Driver\|loadBetterSqlite3Driver\|loadMssqlDriver" apps/studio/src/execute-registry.ts` returns four matches (one call per provider)
- [ ] Each engine `src/index.ts` exports a `loadXxxDriver` and an `isXxxDriverInstalled`
- [ ] `packages/sqlserver/src/index.ts` additionally exports `resolveConnectionInput` and `MssqlConfigInput`
- [ ] `apps/studio/package.json` `dependencies` lists all four `@askdb/{postgres,mysql,sqlite,sqlserver}` as `"workspace:*"`
- [ ] The status endpoint (`apps/studio/src/server.ts:1141` — `getExecuteStatus`) still returns the same JSON shape for each provider (verified by existing `server.test.ts` cases continuing to pass)
- [ ] A `.changeset/*.md` file exists with the minor/patch bumps listed above
- [ ] `plans/README.md` status row for plan 032 updated to `DONE`

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts — the codebase has drifted since this plan was written (run the drift check at the top of the file first; on a mismatch, treat as STOP unless you can map the new shape one-for-one).
- An engine package's existing `*.lazy.test.ts` depends on the singular module-promise shape in a way that the Map-keyed cache breaks — describe the failing case and ask before adapting the cache.
- A change to `createXxxCatalogQueryRunner`'s signature breaks `packages/<engine>/src/connector/provider.ts` (these files pass the URL with no options today and should continue to work; if they don't, STOP).
- `pnpm install` fails after adding the missing engine deps to studio — the workspace symbol names must match `packages/<engine>/package.json` `name`. Verify before touching anything else.
- The status endpoint tests in `apps/studio/src/server.test.ts` start failing — that is the contract for the user-visible install-prompt behavior; STOP and report rather than relaxing the assertion.
- You discover that one of the engine packages has a meaningful behavior difference vs. studio's current path that wasn't captured in this plan (e.g. a different MySQL read-only mode, different transaction wrapping) — STOP and surface it; studio's specific behavior was deliberate per plan 030 and a maintainer should decide whether the engine package should adopt it or studio should keep it.
- After Step 5, the `mssql` `.default` ESM-interop unwrap can't move cleanly into the engine package because the engine package's existing catalog-runner path uses a different shape — keep the unwrap in studio as a temporary measure; the unification still holds because driver-loading itself is delegated. Note it in the plan-completion comment and continue.
- The studio test mock approach cannot intercept `@askdb/sqlserver`'s `loadMssqlDriver` because of vitest module-mock semantics in this repo — switch to mocking `mssql` directly (the bare specifier the loader ultimately calls) and arrange `projectRoot` so the `createRequire` fallback doesn't find a real `mssql` (e.g. a temp dir). If neither approach works, STOP and report.
- The new `loadXxxDriver` export collides with an existing symbol name in the engine package — pick a non-colliding name and document it in the changeset.
- Adding `MssqlConfigInput` / `resolveConnectionInput` to the `@askdb/sqlserver` barrel introduces a circular import (it shouldn't — `resolveConnectionInput` is a pure string function).

## Maintenance notes

For the reviewer / future maintainer:

- After this plan, the rule "per-engine knowledge lives in `@askdb/<engine>`" is enforced by the import graph: studio cannot accidentally re-implement a connection-string transformation because it never imports `mssql` (etc.) directly anymore; it always goes through `loadMssqlDriver` and `resolveConnectionInput`. New transformations land in the engine package and propagate to both pathways for free.
- The CLI's introspect path (`apps/cli/src/introspect.ts`) is unaffected by this change because it already uses `createXxxCatalogQueryRunner`. If a future CLI subcommand needs to execute user queries (analogous to studio's execute), it should also use `loadXxxDriver` + studio-style coordinator code — consider lifting `apps/studio/src/execute-registry.ts` into a new shared package (`@askdb/exec`?) at that point. Don't do it preemptively.
- The `studio.execute.provider` config + the four `executeXxx()` functions remain the right boundary between *user-config-driven dispatch* (studio) and *engine knowledge* (the package). Don't fold the dispatch into the engine packages — that would force every consumer to depend on all four.
- Placeholder rewriting (`rewriteSqlServerParams`, `apps/studio/src/execute-registry.ts:274-286`) is a SQL-shape concern, not a driver concern. If `@askdb/core` ever learns to emit dialect-native placeholders, this function can go away — that's a separate plan.
- `resolveConnectionInput` is now part of `@askdb/sqlserver`'s public API. Any future change to its signature is a breaking change for `@askdb/studio` (and any external embedder). Treat the function as a small, stable contract: input is the user's connection string; output is whatever `new mssql.ConnectionPool(...)` accepts.
- Connection-string normalization belongs in the engine packages, not in `@askdb/config`. Config's job is reading the user's intent (env vars → fields → file with precedence) and structurally validating the schema; the string's *contents* are opaque at that layer. The exact thing `resolveConnectionInput` does — translating `mssql://` URLs and rewriting `Trust Server Certificate=` because `@tediousjs/connection-string` v1.x dropped it after lowercasing — is driver-version knowledge that should move with the driver's peer range, not with config. When Postgres or MySQL needs analogous normalization, land it as `resolvePgConnectionInput` / `resolveMysqlConnectionInput` in the matching engine package; do not centralize.
- If `mssql` itself ever publishes a v13+ that fixes URL parsing or ADO.NET key normalization upstream, `resolveConnectionInput` becomes a legacy shim; revisit at that point.
- If a hosted/remote variant of studio is ever built, the `resolveFrom` option is the seam for pointing driver resolution at the user's workspace mount rather than the server's cwd — already in place because of this plan.

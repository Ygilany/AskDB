# Plan 030: Let Studio execute generated SQL against any supported live dialect

- **Date:** 2026-06-25
- **Planned at commit:** `7152dec`
- **Priority:** P1
- **Effort:** L
- **Risk:** Medium-high
- **Depends on:** 029
- **Status:** TODO
- **Skill:** improve

## Summary

Studio's Query Playground currently has a Postgres-only execute path even though the rest of the system now treats live database drivers as dialect-owned optional peers. The next change should make Studio execution dialect-aware for Postgres, MySQL, SQLite, and SQL Server; expose a driver-readiness status to the browser; and give local Studio users a safe install-and-retry path when the configured dialect's driver is missing.

Do this without moving database drivers back into CLI or Studio as hard dependencies. Keep them optional peers plus Studio dev dependencies for local compilation/tests.

## Problem

The current boundary is inconsistent:

- `apps/studio/src/server.ts:1123` reads only `getAskDbRuntimeConfig().studio.execute.databaseUrl`.
- `apps/studio/src/server.ts:1146` dynamically imports only `pg`.
- `apps/studio/src/server.ts:1151` tells every user to install `pg`, even when the active schema was introspected from MySQL, SQLite, or SQL Server.
- `packages/config/src/types.ts:332` only models `studio.execute.databaseUrl`; there is no Studio execute provider/dialect.
- `packages/config/src/flatten.ts:268` only flattens `ASKDB_STUDIO_DATABASE_URL`.
- `packages/config/src/runtime-config.ts:92` only exposes `studio.execute.databaseUrl`.
- `apps/studio/src/web/api.ts:105` and `apps/studio/src/web/contexts/playground-context.tsx:249` only know about the execute call itself, not readiness or missing-driver remediation.

That is why the Studio UI can say it is working against an MSSQL-backed project while the execute endpoint still behaves like a Postgres-only tool.

## Goals

- Studio can execute SQL against the configured live dialect: `postgres`, `mysql`, `sqlite`, or `sqlserver`.
- Studio surfaces the configured execute provider and whether the needed driver package is installed.
- Studio can offer a safe, allowlisted local install action for the missing driver package and retry execution without requiring users to understand optional peer dependencies.
- The package architecture stays clean: drivers are not hard dependencies of the CLI, and Studio does not force every user to install every database client at runtime.
- Docs explain the split between optional peer dependencies and dev dependencies clearly enough to resolve the current review comments.

## Non-goals

- Do not build a generic npm package manager inside Studio.
- Do not allow arbitrary package names or shell commands from the browser.
- Do not add support for providers beyond the current built-in live engines.
- Do not change SQL generation semantics in `@askdb/core`.
- Do not require Docker-backed integration databases for this change.
- Do not make hosted/remote Studio mutate server dependencies. The install action is for local development only.

## Design Decisions

### 1. Keep drivers as optional peers

`@askdb/studio` should declare optional peers for the drivers it can use:

- `pg`
- `mysql2`
- `better-sqlite3`
- `mssql`

It should also list those packages in `devDependencies` so the Studio package can compile, run tests, and provide type coverage inside the monorepo. That is not a runtime ownership statement. It only means this package's local development and CI need the packages available.

This preserves the package boundary from plan 029: applications choose which live driver they need, while first-party packages can still advertise compatible peers and produce clear missing-driver errors.

### 2. Add an explicit Studio execute provider

Add config support for:

```ts
studio: {
  execute: {
    provider?: "postgres" | "mysql" | "sqlite" | "sqlserver";
    databaseUrl?: string;
    file?: string;
  };
}
```

Resolution order:

1. `studio.execute.provider`
2. `introspection.provider`, when it is one of the live execute providers
3. `"postgres"` for backward compatibility

Connection resolution:

- `postgres`: `studio.execute.databaseUrl` then active introspection Postgres URL.
- `mysql`: `studio.execute.databaseUrl` then active introspection MySQL URL.
- `sqlserver`: `studio.execute.databaseUrl` then active introspection SQL Server URL.
- `sqlite`: `studio.execute.file` then active introspection SQLite file.

Flatten canonical keys:

- `ASKDB_STUDIO_EXECUTE_PROVIDER`
- `ASKDB_STUDIO_DATABASE_URL`
- `ASKDB_STUDIO_SQLITE_FILE`

Keep `ASKDB_STUDIO_DATABASE_URL` for compatibility and for network databases. Do not overload it for SQLite if a dedicated `file` field is easy to add now.

### 3. Add a small execute-driver registry in Studio

Introduce a private registry in `apps/studio/src/server.ts` or a focused helper module:

```ts
type StudioExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

type StudioExecuteDriverDefinition = {
  provider: StudioExecuteProvider;
  label: string;
  packageName: "pg" | "mysql2" | "better-sqlite3" | "mssql";
  installCommand: string;
  execute(input: {
    connectionString?: string;
    file?: string;
    sql: string;
    params: unknown[];
  }): Promise<ExecuteResponse>;
};
```

Each implementation should dynamically import only its own package.

Execution semantics:

- Postgres: preserve the current `BEGIN READ ONLY`, query, `COMMIT`/`ROLLBACK`, and 500-row truncation behavior.
- MySQL: use `mysql2/promise`; start a read-only transaction where supported, execute with `?` placeholders, roll back on error, close the connection.
- SQLite: use `better-sqlite3` in `{ readonly: true, fileMustExist: true }` mode; execute with `?` placeholders; close the database.
- SQL Server: use `mssql`; bind positional params as `p0`, `p1`, etc., so SQL uses `@p0`, `@p1`; close the pool.

Normalize every engine to the existing `ExecuteResponse` shape: `ok`, `columns`, `rows`, `rowCount`, `durationMs`, `truncated`, or `error`.

### 4. Add execute readiness APIs

Add shared API DTOs in `apps/studio/src/shared/api.ts`:

```ts
export type ExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

export type ExecuteStatusResponse = {
  provider: ExecuteProvider;
  label: string;
  configured: boolean;
  connectionKind: "url" | "file";
  packageName: string;
  installed: boolean;
  installCommand: string;
  canInstallFromStudio: boolean;
  manualInstallReason: string | null;
};

export type ExecuteInstallDriverRequest = {
  provider?: ExecuteProvider;
};

export type ExecuteInstallDriverResponse = {
  ok: boolean;
  provider: ExecuteProvider;
  packageName: string;
  command: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
  installed: boolean;
};
```

Add endpoints:

- `GET /api/execute/status`
- `POST /api/execute/install-driver`

`GET /api/execute/status` should never throw just because a driver is missing. It should return the configured provider and `installed: false`.

`POST /api/execute/install-driver` must:

- Accept only the configured provider, or an allowlisted provider.
- Install only the package from the registry map.
- Use `spawn(command, args, { cwd, shell: false })`; never concatenate a shell command.
- Detect package manager from the nearest project lockfile/package.json: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`/`bun.lock`.
- Return a manual command when no safe package manager can be detected.
- Only allow the action from loopback clients and local Studio hosts.

Prefer not to restart Studio automatically in the first implementation. Dynamic import after install should work in the same Node process for packages added under the project root. If import still fails after install, return `installed: false` and a message telling the UI to show a "Restart Studio" hint.

### 5. Wire the UI around status

Update the Studio web client:

- `apps/studio/src/web/api.ts`: add `getExecuteStatus()` and `installExecuteDriver()`.
- `apps/studio/src/web/contexts/playground-context.tsx`: add `executeStatus`, `refreshExecuteStatus`, and `handleInstallExecuteDriver`.
- `apps/studio/src/web/views/playground/PlaygroundPage.tsx`: show a compact status row near the Execute button:
  - configured provider label
  - configured/missing connection status
  - installed/missing package status
  - install button when `canInstallFromStudio && !installed`
  - manual install command when automatic install is not available

Disable the Execute button only when the connection is not configured or the driver is missing. Do not block SQL generation.

### 6. Address docs and review comments

Update:

- `apps/studio/README.md`
- `apps/docs-site/src/content/docs/studio.mdx`
- `apps/docs-site/src/content/docs/reference/config.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx` if it lists optional peers
- Any CLI docs that now show `pnpm dlx -p ...`; explain that `-p` adds packages to the one-off execution environment, or prefer config-first examples that avoid the flag where possible.

Docs should state:

- Studio execute supports Postgres, MySQL, SQLite, and SQL Server when configured.
- `studio.execute.provider` defaults to the active introspection provider when possible.
- Driver packages are optional peer dependencies because users should not pay for every database client.
- Studio dev dependencies exist for local package development and tests, not because apps must install every driver.
- The Studio install action is a local convenience that installs the dialect's allowlisted driver into the user's project.

## Implementation Steps

1. Update `@askdb/config` types and runtime resolution.
   - Add `AskDbStudioExecuteProvider` or equivalent literal union.
   - Extend `AskDbConfig["studio"]["execute"]`.
   - Flatten `ASKDB_STUDIO_EXECUTE_PROVIDER` and `ASKDB_STUDIO_SQLITE_FILE`.
   - Resolve provider and connection/file in `getAskDbRuntimeConfig()`.
   - Add config tests for explicit provider, introspection fallback, and backward-compatible Postgres fallback.

2. Add Studio execute registry and per-dialect runners.
   - Extract current Postgres code into `executePostgres`.
   - Add MySQL, SQLite, and SQL Server runners.
   - Keep dynamic imports inside each runner.
   - Add a small normalization helper for result rows/columns/truncation.
   - Add test seams for driver loaders so unit tests do not require live databases.

3. Add package-readiness detection.
   - Reuse the project-aware optional-peer resolver pattern introduced by plan 029 where possible.
   - Return missing-driver details instead of throwing inside status checks.
   - Use the same resolver path for `executeQuery()` so `npx`/`pnpm dlx` Studio runs can see project-installed drivers.

4. Add local package install endpoint.
   - Add lockfile/package-manager detection.
   - Add loopback/local-host guard.
   - Use an allowlist from the execute registry, not request-provided package names.
   - Capture bounded stdout/stderr.
   - Refresh driver readiness after install.

5. Wire the web client.
   - Add shared DTOs and API functions.
   - Load status on Playground mount and before execute.
   - Add install/retry UI.
   - Keep the UI compact; this is operational status, not a docs page.

6. Update package metadata.
   - Add optional peers for `pg`, `mysql2`, `better-sqlite3`, and `mssql` in `apps/studio/package.json`.
   - Add matching dev dependencies needed for tests/types.
   - Update the lockfile.

7. Update docs and add a changeset.
   - Include the Studio docs, config reference, and package reference updates above.
   - Add a changeset for `@askdb/config` and `@askdb/studio`.

## Testing Plan

Run targeted tests first:

```bash
pnpm -C packages/config test
pnpm -C apps/studio test -- src/server.test.ts
pnpm -C apps/studio build
pnpm docs:build
```

Then run broader checks:

```bash
pnpm test
pnpm smoke:install
pnpm lint
```

Known caveat from plan 029 verification: `pnpm lint` may still fail on the pre-existing docs-site virtual Starlight import issue in `apps/docs-site/src/components/overrides/Header.astro`. If that remains the only lint failure, record it in the implementation closeout instead of broadening this plan.

Add unit coverage for:

- `studio.execute.provider` explicit config.
- Provider fallback from `introspection.provider`.
- SQLite file fallback from active introspection config.
- Status endpoint for configured SQL Server with missing `mssql`.
- Status endpoint for installed driver using injected resolver.
- Install endpoint rejects unknown providers/package names.
- Install endpoint returns a manual command when package-manager detection fails.
- Execute endpoint dispatches to each provider runner with params.
- Missing connection returns `ok: false` without attempting driver import.

## Stop Conditions

Stop and ask for a maintainer decision if:

- The package installer cannot be made loopback-only without invasive server changes.
- `better-sqlite3` materially breaks install/build expectations in the Studio package.
- Existing generated SQL uses one placeholder style regardless of dialect; that would make SQL Server/MySQL execution semantics a larger core/compiler issue rather than a Studio runner issue.
- The config team prefers a single `studio.execute.connection` object over `databaseUrl`/`file` fields.

## Acceptance Criteria

- A SQL Server Studio project reports `provider: "sqlserver"` and missing package `mssql`, not `pg`.
- The Query Playground can install the configured missing driver from an allowlisted button in local Studio, or show the exact manual command.
- After installing the driver, Studio can retry execution without a manual restart when Node resolution allows it.
- Postgres execution continues to work for existing `studio.execute.databaseUrl` configs.
- Docs no longer imply Studio execute is Postgres-only.
- Optional peer dependency rationale is documented for both CLI/introspection and Studio/execute paths.

import { AskDbError, SqlExecutionError } from "../errors.js";
import type { AskDbExecutor } from "./executor.js";
import type { TabularResult } from "./types.js";

export type { TabularResult } from "./types.js";

/**
 * Lazily resolve the optional `pg` peer dependency. `pg` is intentionally NOT imported at the
 * top of this module — Phase 4 makes it an optional `peerDependency`, so consumers who only use
 * a custom `AskDbExecutor` must be able to import `@askdb/core` (and even `@askdb/core/postgres`)
 * without having `pg` installed. The cost of the missing peer is paid only when the built-in
 * executor is actually invoked.
 *
 * Result is cached so repeated calls don't re-resolve. On a missing peer we clear the cache so
 * the next call retries (e.g. after the consumer runs `pnpm add pg`).
 */
let pgModulePromise: Promise<typeof import("pg")> | undefined;

async function loadPgOrThrow(): Promise<typeof import("pg")> {
  if (!pgModulePromise) {
    pgModulePromise = import("pg").catch((cause) => {
      pgModulePromise = undefined;
      throw new AskDbError(
        "The built-in Postgres executor requires the optional `pg` peer dependency. " +
          "Install it (e.g. `pnpm add pg`) or pass a custom `executor` to `ask()`. " +
          "See docs/integration/installable-package.md for BYO executor recipes.",
        cause,
      );
    });
  }
  return pgModulePromise;
}

/**
 * @internal exposed for tests that need to reset the lazy `pg` cache between cases.
 */
export function __resetPgModuleCacheForTests(): void {
  pgModulePromise = undefined;
}

export async function executeReadOnlySelect(
  connectionString: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<TabularResult> {
  const mod = await loadPgOrThrow();
  // `pg` is CJS — Node's ESM interop puts the namespace under `.default` at runtime, but the
  // static type doesn't model that. Reach for `default` defensively, then fall back to the
  // top-level namespace for bundlers that hoist the CJS named exports.
  const pgRuntime = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const pool = new pgRuntime.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res =
      params && params.length > 0
        ? await client.query<{ [k: string]: unknown }>(sql, params as unknown[])
        : await client.query<{ [k: string]: unknown }>(sql);
    await client.query("COMMIT");
    const fields = res.fields ?? [];
    const columns = fields.map((f) => f.name);
    const rows = res.rows.map((row) => fields.map((f) => row[f.name]));
    return { columns, rows };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new SqlExecutionError(`PostgreSQL execution failed: ${message}`, e);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Build the built-in `pg`-backed {@link AskDbExecutor} that {@link import("../ask.js").ask} uses
 * by default when only a `connectionString` is supplied.
 *
 * Each invocation runs the SQL inside a fresh connection's `BEGIN READ ONLY` transaction (see
 * {@link executeReadOnlySelect}) — the read-only invariant of the executor seam contract is
 * enforced at the database layer, not by the caller.
 *
 * The factory itself is synchronous and does NOT load `pg`. The peer dependency is resolved
 * the first time the returned executor is invoked; if `pg` is not installed, the executor
 * rejects with a helpful {@link AskDbError} pointing the consumer at install or BYO recipes.
 */
export function createPostgresExecutor(connectionString: string): AskDbExecutor {
  return (sql, params) => executeReadOnlySelect(connectionString, sql, params);
}

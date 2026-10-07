/**
 * Runs `ask()` with a stand-in model that joins the multi-engine fixture's `billing.order`
 * to `org.agency`, naming both exactly as the NL→SQL prompt lists them. Resolves to the
 * SQL `ask()` returns: one row with `n`, the number of orders.
 *
 * Typed loosely: `@askdb/core` doesn't resolve from `scripts/`. Pass `ask`, a loaded schema
 * and a built-in dialect id.
 */
export declare function askCopyingListedTableNames(
  askFn: (options: never) => Promise<{ sql: string }>,
  schema: unknown,
  dialect: "postgres" | "cockroachdb" | "mysql" | "mariadb" | "sqlserver" | "sqlite",
): Promise<string>;

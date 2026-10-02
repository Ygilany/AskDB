import type { CatalogQueryResult, SqlForeignKeyAction } from "../types.js";

export type RowsToRecordsOptions = {
  /**
   * Columns the caller's SQL promises to return. When set, only these columns
   * are copied into each record, and a result that lacks one of them throws —
   * that signals a runner or bundle that does not match the query's contract.
   * When omitted, every returned column is copied.
   */
  expectedColumns?: readonly string[];
  /** Prefix for the missing-column error, e.g. `"@askdb/postgres"`. */
  source?: string;
};

/**
 * Turn a positional `CatalogQueryResult` into one record per row keyed by
 * column name. A result with zero rows yields `[]` even when the runner
 * omitted the column headers (some drivers / fake runners don't populate them
 * on empty result sets).
 */
export function rowsToRecords<T>(result: CatalogQueryResult, options: RowsToRecordsOptions = {}): T[] {
  if (result.rows.length === 0) return [];
  const indexByName = new Map<string, number>();
  if (options.expectedColumns) {
    for (const name of options.expectedColumns) {
      const idx = result.columns.indexOf(name);
      if (idx === -1) {
        const prefix = options.source ? `${options.source}: ` : "";
        throw new Error(
          `${prefix}result is missing column '${name}' (got [${result.columns.join(", ")}])`,
        );
      }
      indexByName.set(name, idx);
    }
  } else {
    for (let i = 0; i < result.columns.length; i++) indexByName.set(result.columns[i]!, i);
  }
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const [name, idx] of indexByName) record[name] = row[idx];
    return record as T;
  });
}

/** Group rows by key, preserving first-seen key order and row order within a group. */
export function groupBy<T, K>(rows: Iterable<T>, key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k) ?? [];
    list.push(row);
    out.set(k, list);
  }
  return out;
}

/**
 * Group rows by key, order each group by `position` (e.g. a constraint's
 * column ordinal), and build one named object per group; `build` may return
 * `undefined` to drop a group. The result is sorted by name — the shape every
 * multi-column constraint/index builder needs for deterministic output.
 */
export function buildOrderedGroups<T, K, R extends { name: string }>(
  rows: Iterable<T>,
  key: (row: T) => K,
  position: (row: T) => number,
  build: (key: K, ordered: T[]) => R | undefined,
): R[] {
  const out: R[] = [];
  for (const [k, list] of groupBy(rows, key)) {
    const built = build(k, list.slice().sort((a, b) => position(a) - position(b)));
    if (built !== undefined) out.push(built);
  }
  return out.sort(byName);
}

/** Comparator: `localeCompare` on `.name`. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Deduplicate and `localeCompare`-sort. */
export function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/**
 * Map an SQL-standard referential action name (`CASCADE`, `SET NULL`, …;
 * case-insensitive) to the Schema v2 action. Unknown or empty → `undefined`.
 */
export function mapFkAction(rule: string | null | undefined): SqlForeignKeyAction | undefined {
  if (!rule) return undefined;
  const r = rule.toLowerCase();
  if (r === "cascade") return "cascade";
  if (r === "restrict") return "restrict";
  if (r === "set null") return "set null";
  if (r === "set default") return "set default";
  if (r === "no action") return "no action";
  return undefined;
}

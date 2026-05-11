/**
 * Test helpers for the Postgres connector — kept under `src/` (not under
 * `test/`) so vitest's path resolution stays simple. Excluded from `dist/`
 * by `tsconfig.build.json`'s `*.test.ts` filter — but this file isn't a
 * test, so we put it in a sibling that the build also excludes.
 *
 * NOTE: filename ends with `.test-utils.ts` only by convention; the build's
 * `exclude` glob is on `*.test.ts`, so this file *is* compiled into `dist/`.
 * That's fine — it's small and unused outside of tests.
 */
import { readFileSync } from "node:fs";
import type { AskDbExecutor, TabularResult } from "@askdb/core";
import type { SqlTemplate } from "@askdb/introspect";
import { POSTGRES_TEMPLATES, type PostgresSqlTemplateName } from "./templates.js";

export type CatalogSnapshot = Partial<
  Record<PostgresSqlTemplateName, ReadonlyArray<Record<string, unknown>>>
>;

export function loadCatalogSnapshot(path: string): CatalogSnapshot {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`catalog snapshot ${path}: expected an object`);
  }
  return parsed as CatalogSnapshot;
}

/**
 * Build a fake `AskDbExecutor` that dispatches on the SQL string identity:
 * for each known template, returns the rows in the snapshot (or an empty
 * result if the snapshot omits that template). Fails loudly on an unknown
 * SQL — that catches drift between the templates and the snapshot.
 */
export function createSnapshotExecutor(
  snapshot: CatalogSnapshot,
): AskDbExecutor {
  const byTemplateSql = new Map<string, SqlTemplate>();
  for (const tpl of POSTGRES_TEMPLATES) byTemplateSql.set(tpl.sql, tpl);
  return async (sql) => {
    const tpl = byTemplateSql.get(sql);
    if (!tpl) {
      throw new Error(
        "snapshot executor: SQL did not match any known Postgres template — drift between templates.ts and the snapshot.",
      );
    }
    const rows = snapshot[tpl.name as PostgresSqlTemplateName] ?? [];
    return rowsToTabularResult(tpl, rows);
  };
}

function rowsToTabularResult(
  tpl: SqlTemplate,
  rows: ReadonlyArray<Record<string, unknown>>,
): TabularResult {
  const cols = [...tpl.columns];
  return {
    columns: cols,
    rows: rows.map((row) => cols.map((c) => row[c] ?? null)),
  };
}

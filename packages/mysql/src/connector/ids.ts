/**
 * Schema v2 ID conventions — kept aligned with `@askdb/postgres/connector/ids.ts`.
 * MySQL doesn't have Postgres-style schemas, but to keep IDs stable and
 * cross-engine queryable we always use the namespace `"public"` (the same
 * convention `@askdb/prisma` uses for MySQL).
 */
export function makeTableId(schemaName: string, tableName: string): string {
  return `table:${schemaName}.${tableName}`;
}

export function makeColumnId(
  schemaName: string,
  tableName: string,
  columnName: string,
): string {
  return `table:${schemaName}.${tableName}#${columnName}`;
}

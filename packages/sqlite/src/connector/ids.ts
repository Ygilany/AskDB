/**
 * Schema v2 ID conventions — kept aligned with the postgres / mysql connectors.
 * SQLite has a single namespace per database; we emit `"public"` to match
 * `@askdb/prisma`'s default and keep table ids cross-engine stable.
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

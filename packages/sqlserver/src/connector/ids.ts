/** Schema v2 ID conventions — aligned with the postgres / mysql / sqlite connectors. */
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

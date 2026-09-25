/**
 * Schema v2 ID conventions (see docs/contracts/schema-v2.md):
 *
 *   table:<schema>.<name>
 *   table:<schema>.<name>#<col>
 *
 * The schema prefix is always included (even for `public`) so cross-schema
 * tables are unambiguous and IDs survive a future move between schemas
 * without colliding. The `#` separator is reserved for column suffixes.
 * Engines without Postgres-style schemas (MySQL, SQLite) use `"public"` so
 * IDs stay stable across engines.
 */
export function makeTableId(schemaName: string, tableName: string): string {
  return `table:${schemaName}.${tableName}`;
}

export function makeColumnId(schemaName: string, tableName: string, columnName: string): string {
  return `table:${schemaName}.${tableName}#${columnName}`;
}

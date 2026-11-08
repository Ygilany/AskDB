import { formatTenantPolicyWarning, type NormalizedSchemaV2, type SchemaV2Warning } from "@askdb/core";

/**
 * The warnings `loadSchema()` returned for `schema`, its tenant policy's included, one stderr line
 * each. `askdb ask` and `askdb bundle` print them and keep their exit code.
 */
export function schemaWarningLines(schema: Pick<NormalizedSchemaV2, "warnings" | "tenantPolicy">): string[] {
  return [
    ...schema.warnings.map((warning) => `Warning: ${formatSchemaWarning(warning)}\n`),
    ...(schema.tenantPolicy?.warnings ?? []).map((warning) => `Warning: tenant-policy.md: ${formatTenantPolicyWarning(warning)}\n`),
  ];
}

/** One line for a loader warning. A new kind fails the build here until it has its line. */
function formatSchemaWarning(warning: SchemaV2Warning): string {
  switch (warning.kind) {
    case "orphaned_table_id":
      return `${warning.tableFile} names table ${warning.id}, which schema.json doesn't have`;
    case "orphaned_column_id":
      return `${warning.tableFile} names column ${warning.id}, which schema.json doesn't have`;
    case "missing_table_md":
      return `table ${warning.tableId} has no file in tables/`;
    case "missing_column_md":
      return `column ${warning.columnId} has no entry in ${warning.tableId}'s table file`;
    case "sensitivity_downgrade_ignored":
      return `${warning.tableFile} sets sensitive: false on ${warning.id}, which is sensitive anyway; sensitivity only escalates, so it stays sensitive`;
    case "misplaced_column_id":
      return `${warning.tableFile} lists column ${warning.id}, which is on ${warning.tableId}; only its sensitive: true applies, so move the entry to that table's file`;
    case "duplicate_column_id":
      return `${warning.tableFile} lists column ${warning.id} more than once; only the first entry's description, aliases and enum apply`;
  }
}

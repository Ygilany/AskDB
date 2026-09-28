/**
 * The shared multi-engine fixture (`fixtures/multi-engine`): its connection URLs, logical
 * schemas and dataset. Imported by path, not installed. The fixture never imports AskDB
 * and its public module loads no database driver, so this adds nothing to what the lab
 * resolves from the install target.
 */
export {
  DIALECTS,
  LOGICAL_SCHEMAS,
  SQLITE_FILE,
  connectionUrl,
  loadRows,
  physicalName,
  type Dialect,
  // The golden-schema comparison (`dataset/NORMALIZATION.md`, "Schema-comparison rules").
  compareToLogicalSchema,
  loadLogicalSchema,
  type SchemaJson,
  // The value and result-set rules (`dataset/NORMALIZATION.md`, "Value rules", "Result-set rules").
  normalizeRows,
  type LogicalType,
} from "../../../fixtures/multi-engine/src/index.js";

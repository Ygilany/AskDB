import type { V2Concept } from "./describable.js";

/** Normalized column with optional v2 describable-layer fields. */
export type NormalizedV2Column = {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  sensitive: boolean;
  /** Describable-layer fields. Absent when sensitive=true (excluded from prompts). */
  description?: string;
  aliases?: string[];
  enum?: string[];
};

/** Normalized table with optional v2 describable-layer fields. */
export type NormalizedV2Table = {
  id: string;
  name: string;
  /** Database schema (namespace) this table belongs to, e.g. `"public"`, `"app"`. */
  schema: string;
  sensitive: boolean;
  columns: NormalizedV2Column[];
  relationships?: Array<{ from: string; to: string }>;
  /** Describable-layer fields. */
  description?: string;
  aliases?: string[];
  primaryEntity?: string;
  /** Verbatim content of the `Common query language` H2 section. */
  commonQueryLanguage?: string;
};

/** Fully normalized Schema v2 artifact — physical + describable layers merged. */
export type NormalizedSchemaV2 = {
  schemaId: string;
  /**
   * SQL dialect identifier the connector inferred when introspection produced
   * this schema (e.g. `"postgres"`, `"mysql"`). Hosts may use this to auto-
   * select the NL→SQL dialect; `askdb.config.dialect` overrides it.
   */
  provider?: string;
  tables: NormalizedV2Table[];
  concepts?: V2Concept[];
  /** Structured warnings from ID validation (orphaned/missing ids). */
  warnings: SchemaV2Warning[];
};

export type SchemaV2Warning =
  | { kind: "orphaned_table_id"; tableFile: string; id: string }
  | { kind: "orphaned_column_id"; tableFile: string; id: string }
  | { kind: "missing_table_md"; tableId: string }
  | { kind: "missing_column_md"; tableId: string; columnId: string };

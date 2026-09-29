import type { V2Concept } from "./describable.js";
import type { NormalizedTenantPolicy } from "./tenant-policy.js";

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
  /** When false, excluded from LLM prompts and RAG indexing. Defaults to true when absent. */
  tracked?: boolean;
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
  tenantPolicy?: NormalizedTenantPolicy;
  /** Structured warnings from ID validation (orphaned/missing ids). */
  warnings: SchemaV2Warning[];
};

export type SchemaV2Warning =
  | { kind: "orphaned_table_id"; tableFile: string; id: string }
  | { kind: "orphaned_column_id"; tableFile: string; id: string }
  | { kind: "missing_table_md"; tableId: string }
  | { kind: "missing_column_md"; tableId: string; columnId: string }
  /**
   * Table markdown front-matter set `sensitive: false` on a table or column that is
   * sensitive anyway (via `schema.json`; for a column, also via its sensitive table or
   * another front-matter entry's `sensitive: true`). Front-matter sensitivity is
   * escalate-only, so the override was ignored.
   */
  | { kind: "sensitivity_downgrade_ignored"; tableFile: string; id: string }
  /**
   * A `columns[]` entry in `tableFile` names a column (`id`) that belongs to another
   * table (`tableId`). Only its `sensitive: true` is applied (escalate-only); every
   * other field is ignored. Move the entry to `tableId`'s markdown.
   */
  | { kind: "misplaced_column_id"; tableFile: string; id: string; tableId: string }
  /**
   * `tableFile`'s `columns[]` lists column `id` again (one warning per repeat). Only the
   * first entry's description, aliases, and enum are applied. Sensitivity is aggregated
   * across every entry: any `sensitive: true` escalates the column, and a duplicate's
   * `sensitive: false` never de-escalates it. Merge the entries into one.
   */
  | { kind: "duplicate_column_id"; tableFile: string; id: string };

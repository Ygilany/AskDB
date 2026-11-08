import { z } from "zod";

export const v2ColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  primaryKey: z.boolean().optional(),
  sensitive: z.boolean().optional(),
});

export const v2RelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const v2TableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Database schema (namespace) this table belongs to, e.g. `"public"`, `"app"`. Required. */
  schema: z.string().min(1),
  sensitive: z.boolean().optional(),
  columns: z.array(v2ColumnSchema).min(1),
  relationships: z.array(v2RelationshipSchema).optional(),
});

export const v2SchemaJsonSchema = z.object({
  version: z.literal(2),
  schemaId: z.string().min(1),
  /**
   * Optional SQL dialect the connector inferred when introspection produced
   * this file (e.g. `"postgres"`, `"mysql"`, `"sqlite"`). Hosts use this to
   * auto-select the NL→SQL dialect; `askdb.config.dialect` overrides it.
   * Matches `DialectId` in `@askdb/core` — kept loose to forward-allow new ids.
   */
  provider: z.string().min(1).optional(),
  tables: z.array(v2TableSchema).min(1),
});

export type V2SchemaJson = z.infer<typeof v2SchemaJsonSchema>;
export type V2Table = z.infer<typeof v2TableSchema>;
export type V2Column = z.infer<typeof v2ColumnSchema>;

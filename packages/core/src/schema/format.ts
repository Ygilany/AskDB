import { z } from "zod";

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  /** When true, column metadata is omitted from NL→SQL prompts (Phase 2 sensitive-field plumbing). */
  sensitive: z.boolean().optional(),
});

const tableSchema = z.object({
  name: z.string().min(1),
  columns: z.array(columnSchema).min(1),
  /** When true, all column definitions for this table are withheld from NL→SQL prompts. */
  sensitive: z.boolean().optional(),
});

export const askDbSchemaFileSchema = z.object({
  version: z.literal(1),
  tables: z.array(tableSchema).min(1),
});

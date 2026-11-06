import { z } from "zod";

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  /**
   * When true, the column is listed in NL→SQL prompt DDL tagged `(sensitive)`, and withheld
   * when prompt omission (`omitSensitiveIdentifiersFromPrompt`) is on.
   */
  sensitive: z.boolean().optional(),
});

const tableSchema = z.object({
  name: z.string().min(1),
  columns: z.array(columnSchema).min(1),
  /**
   * When true, every column of this table is tagged `(sensitive)` in NL→SQL prompt DDL. With
   * prompt omission on, the table keeps a one-line stub and its column definitions are withheld.
   */
  sensitive: z.boolean().optional(),
});

export const askDbSchemaFileSchema = z.object({
  version: z.literal(1),
  tables: z.array(tableSchema).min(1),
});

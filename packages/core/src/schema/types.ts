import { z } from "zod";
import { askDbSchemaFileSchema } from "./format.js";

export type AskDbSchemaFile = z.infer<typeof askDbSchemaFileSchema>;

/** Normalized, describable-schema-friendly shape used by prompts and tooling. */
export type NormalizedSchema = {
  tables: Array<{
    name: string;
    /** Entire table withheld from NL→SQL prompt DDL (optional Phase 2 `sensitive`). */
    sensitive?: boolean;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primaryKey: boolean;
      /** Column omitted from NL→SQL prompt DDL when true. */
      sensitive?: boolean;
    }>;
  }>;
};

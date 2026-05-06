import { z } from "zod";
import { askDbSchemaFileSchema } from "./format.js";

export type AskDbSchemaFile = z.infer<typeof askDbSchemaFileSchema>;

/** Normalized, describable-schema-friendly shape used by prompts and tooling. */
export type NormalizedSchema = {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primaryKey: boolean;
    }>;
  }>;
};

import { z } from "zod";
import { askDbSchemaFileSchema } from "./format.js";
import type { NormalizedSchemaV2 } from "./v2/normalized.js";

export type AskDbSchemaFile = z.infer<typeof askDbSchemaFileSchema>;

/** Normalized, describable-schema-friendly shape used by prompts and tooling. */
export type NormalizedSchema = {
  tables: Array<{
    name: string;
    /** Every column tagged `(sensitive)` in NL→SQL prompt DDL; with prompt omission on, a one-line stub replaces the column definitions. */
    sensitive?: boolean;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primaryKey: boolean;
      /** Column tagged `(sensitive)` in NL→SQL prompt DDL when true; withheld with prompt omission on. */
      sensitive?: boolean;
    }>;
  }>;
};

/** Schema shape accepted by the dialect-agnostic pipeline (covers both v1 and v2 normalized forms). */
export type AnyNormalizedSchema = NormalizedSchema | NormalizedSchemaV2;

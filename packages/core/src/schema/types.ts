import { z } from "zod";
import { askDbSchemaFileSchema } from "./format.js";
import type { NormalizedSchemaV2 } from "./v2/normalized.js";

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

/** Schema shape accepted by the dialect-agnostic pipeline (covers both v1 and v2 normalized forms). */
export type AnyNormalizedSchema = NormalizedSchema | NormalizedSchemaV2;

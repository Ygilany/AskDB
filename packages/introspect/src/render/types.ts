import type { V2SchemaJson } from "@askdb/core";
import type { IntrospectionWarning } from "../types.js";

export type RenderOptions = {
  /** Output directory, typically `"<schemaId>.schema/"`. */
  outDir: string;
  schemaId: string;
  /**
   * Optional dialect identifier (`"postgres"`, `"mysql"`, …) the connector
   * inferred for this source. When set, written to `schema.json` so hosts
   * can auto-select the NL→SQL dialect without re-introspection.
   */
  provider?: string;
  /**
   * When present, ID-anchored merge runs against this directory's existing
   * `schema.json`. Sensitive flags are preserved; the describable layer
   * (`tables/*.md`, `concepts.md`) is read for orphan-warning detection only
   * and is **never** modified.
   */
  existingArtifactDir?: string;
};

export type RenderResult = {
  schemaJsonPath: string;
  warnings: IntrospectionWarning[];
};

/** Options for `renderSchemaV2Body` — `RenderOptions` without the output directory. */
export type RenderBodyOptions = Omit<RenderOptions, "outDir">;

export type RenderBodyResult = {
  /** The Schema v2 document (after the optional merge with an existing artifact). */
  json: V2SchemaJson;
  /** Exact `schema.json` file contents: `JSON.stringify(json, null, 2) + "\n"`. */
  body: string;
  warnings: IntrospectionWarning[];
};

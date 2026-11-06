import type { V2SchemaJson } from "@askdb/core";
import type { EmptyIntrospectionError } from "../errors.js";
import type { IntrospectionFilters, IntrospectionWarning } from "../types.js";

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
   * `schema.json`. Sensitive flags are preserved, and `tables/*.md` is read for
   * orphan-warning detection only. The describable layer (`tables/*.md`,
   * `concepts.md`) is **never** modified.
   */
  existingArtifactDir?: string;
  /**
   * The filters the connector ran with. Read only to name them in the
   * {@link EmptyIntrospectionError} thrown when nothing matched.
   */
  filters?: IntrospectionFilters;
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

import type { SqlSchema } from "../types.js";
import type { RenderOptions, RenderResult } from "./types.js";

/**
 * Render a `SqlSchema` to a Schema v2 directory. Lands in milestone 3 (clean
 * write) and milestone 6 (ID-anchored merge) of phase 6.
 */
export function renderToSchemaV2(
  _schema: SqlSchema,
  _options: RenderOptions,
): RenderResult {
  throw new Error(
    "@askdb/introspect: renderToSchemaV2() is not implemented yet. " +
      "It lands in milestones 3 + 6 of phase 6 (see docs/specs/phase-6-introspection/plan.md).",
  );
}

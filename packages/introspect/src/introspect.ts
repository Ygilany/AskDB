import type { IntrospectionInput, IntrospectionResult } from "./types.js";
import type { RenderOptions, RenderResult } from "./render/types.js";

/**
 * Run a connector against the given input and (optionally) render the result
 * into a Schema v2 directory. The connector + renderer are wired in milestones
 * 2–7 of phase 6; this entry point exists in milestone 1 so the public surface
 * is stable across the package's first build.
 */
export async function introspect(
  _input: IntrospectionInput,
  _renderOptions?: RenderOptions,
): Promise<IntrospectionResult & { render?: RenderResult }> {
  throw new Error(
    "@askdb/introspect: introspect() is not implemented yet. " +
      "It lands in milestones 2–4 of phase 6 (see docs/specs/phase-6-introspection/plan.md).",
  );
}

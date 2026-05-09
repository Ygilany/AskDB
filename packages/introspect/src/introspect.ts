import type { Connector, IntrospectionInput, IntrospectionResult } from "./types.js";
import type { RenderOptions, RenderResult } from "./render/types.js";
import { renderToSchemaV2 } from "./render/render.js";
import { createPostgresConnector } from "./postgres/index.js";

/**
 * Options for choosing the engine connector. Phase 6 ships only Postgres;
 * Phase 10 will add more engines behind the same `Connector` interface
 * (`@askdb/introspect/<engine>` sub-exports). Until then the connector
 * defaults to Postgres and integrators can pass a custom `connector` for
 * tests or experimental engines.
 */
export type IntrospectOptions = {
  connector?: Connector;
};

export type IntrospectResult = IntrospectionResult & {
  /** Present when `renderOptions` was supplied; points at the written `schema.json`. */
  render?: RenderResult;
};

/**
 * Run a connector against the given input and (optionally) render the result
 * into a Schema v2 directory. End-to-end live mode lands here in milestone 4
 * (per docs/specs/phase-6-introspection/plan.md). Air-gapped (`from-export`)
 * mode is wired in M5; the connector still throws on it.
 */
export async function introspect(
  input: IntrospectionInput,
  renderOptions?: RenderOptions,
  options: IntrospectOptions = {},
): Promise<IntrospectResult> {
  const connector = options.connector ?? createPostgresConnector();
  const result = await connector.describe(input);

  if (!renderOptions) return result;

  // The renderer's schemaId is the source of truth for the on-disk artifact;
  // the connector's `SqlSchema.schemaId` is informational. We pass the
  // renderer's schemaId through unchanged so the v2 file matches the
  // user-supplied identity (e.g. CLI's `--schema-id` flag in M7).
  const render = renderToSchemaV2(result.schema, renderOptions);
  // Surface render-time warnings (orphan IDs etc.; M6) alongside connector
  // warnings so callers see the union.
  return {
    ...result,
    warnings: [...result.warnings, ...render.warnings],
    render,
  };
}

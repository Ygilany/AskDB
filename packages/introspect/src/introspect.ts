import type { Connector, IntrospectionResult } from "./types.js";
import type { RenderOptions, RenderResult } from "./render/types.js";
import { renderToSchemaV2 } from "./render/render.js";

/**
 * Options for the introspection orchestrator. The `connector` is the integration package's
 * `Connector` (e.g. `createPostgresConnector()` from `@askdb/postgres`). Engine-agnostic
 * introspect has no default — callers wire up the integration explicitly.
 */
export type IntrospectOptions<TInput> = {
  connector: Connector<TInput>;
};

export type IntrospectResult = IntrospectionResult & {
  /** Present when `renderOptions` was supplied; points at the written `schema.json`. */
  render?: RenderResult;
};

/**
 * Run an integration connector against the given input and (optionally) render the result
 * into a Schema v2 directory.
 *
 * The input shape is owned by the integration package — for `@askdb/postgres` it is
 * `PostgresIntrospectionInput` (live or from-export). For a future Prisma integration it
 * would be a `schema.prisma` file path.
 */
export async function introspect<TInput>(
  input: TInput,
  renderOptions: RenderOptions | undefined,
  options: IntrospectOptions<TInput>,
): Promise<IntrospectResult> {
  const result = await options.connector.describe(input);

  if (!renderOptions) return result;

  const render = renderToSchemaV2(result.schema, renderOptions);
  return {
    ...result,
    warnings: [...result.warnings, ...render.warnings],
    render,
  };
}

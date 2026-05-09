import type {
  Connector,
  IntrospectionInput,
  IntrospectionResult,
  SqlTemplateBundle,
} from "../types.js";
import { describePostgresFromExport } from "./bundle.js";
import { describePostgres } from "./describe.js";
import { POSTGRES_TEMPLATE_BUNDLE } from "./templates.js";

/**
 * Postgres connector. The catalog SQL suite + describe() implementation land
 * in milestone 2; air-gapped bundle reading lands in milestone 5.
 *
 * See docs/specs/phase-6-introspection/requirements.md §4.
 */
export function createPostgresConnector(): Connector {
  return {
    engine: "postgres",
    async describe(input: IntrospectionInput): Promise<IntrospectionResult> {
      if (input.mode === "from-export") {
        return describePostgresFromExport({
          bundlePath: input.bundlePath,
          filters: input.filters,
        });
      }
      return describePostgres({
        executor: input.executor,
        filters: input.filters,
      });
    },
    templates(): SqlTemplateBundle {
      return POSTGRES_TEMPLATE_BUNDLE;
    },
  };
}

export {
  POSTGRES_TEMPLATE_BUNDLE,
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
} from "./templates.js";
export { describePostgres } from "./describe.js";
export type { DescribePostgresInput } from "./describe.js";
export { describePostgresFromExport } from "./bundle.js";
export type { DescribePostgresExportInput } from "./bundle.js";

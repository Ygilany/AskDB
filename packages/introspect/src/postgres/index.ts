import type {
  Connector,
  IntrospectionInput,
  IntrospectionResult,
  SqlTemplateBundle,
} from "../types.js";

/**
 * Postgres connector skeleton. Catalog SQL suite + describe() implementation
 * land in milestone 2; air-gapped bundle reading lands in milestone 5.
 *
 * See docs/specs/phase-6-introspection/requirements.md §4.
 */
export function createPostgresConnector(): Connector {
  return {
    engine: "postgres",
    async describe(_input: IntrospectionInput): Promise<IntrospectionResult> {
      throw new Error(
        "@askdb/introspect/postgres: describe() is not implemented yet. " +
          "It lands in milestones 2 + 5 of phase 6 (see docs/specs/phase-6-introspection/plan.md).",
      );
    },
    templates(): SqlTemplateBundle {
      throw new Error(
        "@askdb/introspect/postgres: templates() is not implemented yet. " +
          "It lands in milestones 2 + 5 of phase 6 (see docs/specs/phase-6-introspection/plan.md).",
      );
    },
  };
}

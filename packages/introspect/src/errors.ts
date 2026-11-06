import { AskDbError } from "@askdb/core";
import type { IntrospectionFilters } from "./types.js";

/**
 * Thrown when introspection renders no tables or views, after filters. `loadSchema` rejects an
 * artifact with no tables, so nothing is written and an existing `schema.json` and `tables/*.md`
 * stay as they were (ADR 0037). The message names the schema id, the engine (`provider`) and the
 * filters, never the connection.
 */
export class EmptyIntrospectionError extends AskDbError {
  readonly schemaId: string;
  readonly provider: string | undefined;
  readonly filters: IntrospectionFilters | undefined;

  constructor({ schemaId, provider, filters }: { schemaId: string; provider?: string; filters?: IntrospectionFilters }) {
    super(emptyMessage(schemaId, provider, filters));
    this.name = "EmptyIntrospectionError";
    this.schemaId = schemaId;
    this.provider = provider;
    this.filters = filters;
  }
}

function emptyMessage(schemaId: string, provider: string | undefined, filters: IntrospectionFilters | undefined): string {
  const named = [
    ["schemas", filters?.schemas],
    ["exclude schemas", filters?.excludeSchemas],
    ["tables", filters?.tables],
  ]
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0)
    .map(([label, values]) => `${label}: ${values.join(", ")}`)
    .join("; ");
  const causes = [
    "the source has no tables or views",
    "the connection or schema file points at the wrong database or schema",
    ...(named ? [`the filters match nothing (${named})`] : []),
    "the user can't read the catalog",
  ];
  const engine = provider ? ` (${provider})` : "";
  return (
    `Introspection found no tables or views for schema "${schemaId}"${engine}, so nothing was written. ` +
    `Check whether ${causes.slice(0, -1).join(", ")}, or ${causes[causes.length - 1]}.`
  );
}

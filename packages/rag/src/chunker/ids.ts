/**
 * Chunk-id helpers.
 *
 * Chunk ids are scoped to the schema so several schemas can share one vector
 * store: `chunk:<schemaId>:<local-id>`, e.g.
 * `chunk:orders-users:table:public.orders#cql`. `%` and `:` in the schema id
 * are percent-encoded (`shop:eu` → `shop%3Aeu`), so the first `:` after
 * `chunk:` always ends the schema id: two different (schemaId, local id) pairs
 * never produce the same id, and one schema's prefix never matches another's.
 */

/** Prefix shared by every chunk id of `schemaId` (`chunk:<encoded schemaId>:`). */
export function chunkIdPrefix(schemaId: string): string {
  return `chunk:${encodeSchemaId(schemaId)}:`;
}

/** Build a schema-scoped chunk id from a schema-local id (e.g. `table:public.orders#cql`). */
export function chunkId(schemaId: string, localId: string): string {
  return `${chunkIdPrefix(schemaId)}${localId}`;
}

function encodeSchemaId(schemaId: string): string {
  return schemaId.replace(/%/g, "%25").replace(/:/g, "%3A");
}

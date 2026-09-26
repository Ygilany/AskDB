/**
 * Chunk-id helpers.
 *
 * Chunk ids are scoped to the schema so several schemas can share one vector
 * store: `chunk:<schemaId>:<local-id>`, e.g.
 * `chunk:orders-users:table:public.orders#cql`.
 */

/** Prefix shared by every chunk id of `schemaId` (`chunk:<schemaId>:`). */
export function chunkIdPrefix(schemaId: string): string {
  return `chunk:${schemaId}:`;
}

/** Build a schema-scoped chunk id from a schema-local id (e.g. `table:public.orders#cql`). */
export function chunkId(schemaId: string, localId: string): string {
  return `${chunkIdPrefix(schemaId)}${localId}`;
}

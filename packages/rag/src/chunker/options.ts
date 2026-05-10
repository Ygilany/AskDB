/** Default character ceiling for a chunk before paragraph-boundary splitting kicks in. */
export const DEFAULT_CHUNK_MAX_CHARS = 1000;

/** Options accepted by `chunkSchema` / `chunkSchemaDir`. */
export type ChunkOptions = {
  /**
   * When true, describable-layer chunks for sensitive columns/tables are
   * **included**. Off by default per `docs/contracts/schema-v2.md`.
   * Flipping this on emits a `askdb.rag.sensitive_chunks_included` warning.
   */
  includeSensitiveDescribable?: boolean;
  /**
   * Character ceiling for a single chunk's text. Long bodies (e.g.
   * `Business context`) are split on paragraph boundaries and suffixed
   * `#bc:1`, `#bc:2`, etc. Default {@link DEFAULT_CHUNK_MAX_CHARS}.
   */
  chunkSizeMaxChars?: number;
  /**
   * Emit `relationship` chunks (one per FK). Default `false` — table chunks
   * already include a relationship summary; the dedicated chunks are useful
   * for retrieval over very large schemas.
   */
  emitRelationships?: boolean;
};

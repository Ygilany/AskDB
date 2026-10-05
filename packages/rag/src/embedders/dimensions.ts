import type { Embedder } from "../types.js";

/** Embedded to learn a model's vector width; short, so the call costs next to nothing. */
const PROBE_TEXT = "AskDB embedding width probe";

/**
 * Learns an embedder's vector width by embedding one short text, so nothing has to assume it.
 * Use it when a store needs the width before the first vector is written, such as a new pgvector
 * table: `createPgvectorStore({ …, dimensions: await detectEmbeddingDimensions(embedder) })`.
 * Costs one embedding call.
 */
export async function detectEmbeddingDimensions(embedder: Embedder): Promise<number> {
  const vectors = await embedder([PROBE_TEXT]);
  const width = vectors.length === 1 ? vectors[0]!.length : 0;
  if (width === 0) {
    throw new Error(
      `detectEmbeddingDimensions: expected one non-empty vector for one text, got ${vectors.length} ` +
        `vector(s)${vectors.length === 1 ? " of length 0" : ""}.`,
    );
  }
  return width;
}

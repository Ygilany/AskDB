import { createHash } from "node:crypto";

/** Content hash used for skip-reembed bookkeeping. SHA-256, hex. */
export function chunkContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Hash the indexer stores with each vector (`UpsertRecord.hash`): the chunk
 * text **and** the embedder id that produced the vector, so a stored hash
 * proves both. An interrupted embedder or store switch can then never pass
 * another model's vector off as current. SHA-256, hex.
 */
export function storedVectorHash(text: string, embedderId: string | undefined): string {
  return createHash("sha256")
    .update(embedderId ?? "", "utf8")
    .update("\u0000", "utf8")
    .update(text, "utf8")
    .digest("hex");
}

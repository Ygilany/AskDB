import { readFileSync, writeFileSync } from "node:fs";

/**
 * `schema.lock.json` shape — machine-managed pointer used by the indexer to
 * skip re-embedding chunks whose content hasn't changed.
 *
 * Lives next to the v2 artifact (`<schemaId>.schema/schema.lock.json`).
 */
export type SchemaLockFile = {
  /** File-format version. Bump on breaking shape changes. */
  version: 1;
  /** Schema id this lock is bound to. */
  schemaId: string;
  /** Embedder id the embeddings were produced with (e.g. `openai:text-embedding-3-small`). */
  embedderId?: string;
  /** Vector dimensions (informational; the store enforces). */
  dimensions?: number;
  /** chunkId → SHA-256 content hash of the chunk's text. */
  hashes: Record<string, string>;
  /** ISO 8601 timestamp of last successful index. */
  updatedAt?: string;
};

export function readLockFile(path: string): SchemaLockFile | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return undefined;
  }
  return parsed as SchemaLockFile;
}

export function writeLockFile(path: string, lock: SchemaLockFile): void {
  // Sort keys for deterministic on-disk output.
  const sortedHashes: Record<string, string> = {};
  for (const k of Object.keys(lock.hashes).sort()) {
    sortedHashes[k] = lock.hashes[k];
  }
  const out: SchemaLockFile = { ...lock, hashes: sortedHashes };
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
}

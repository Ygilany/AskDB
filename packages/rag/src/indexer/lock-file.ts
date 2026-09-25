import { readFileSync, writeFileSync } from "node:fs";

/** Current `schema.lock.json` format version. */
export const SCHEMA_LOCK_VERSION = 2;

/**
 * `schema.lock.json` shape — machine-managed bookkeeping used by the indexer
 * to skip re-embedding chunks whose content hasn't changed.
 *
 * Lives next to the v2 artifact (`<schemaId>.schema/schema.lock.json`).
 *
 * The lock is advisory: stores that can report stored content hashes
 * (`VectorStore.hashesByPrefix` — all built-in stores) are the source of truth
 * for what is already embedded; the lock only guards embedder identity for
 * them. Stores that cannot report hashes fall back to `hashes` here, guarded
 * by `store`, `dimensions`, and `embedderId`.
 *
 * Version history:
 * - `1` — unscoped chunk ids (`chunk:table:public.orders`), no store identity.
 * - `2` — schema-scoped chunk ids (`chunk:<schemaId>:table:public.orders`),
 *   records `store` identity and `dimensions`. A v1 lock triggers a one-time
 *   full reindex.
 */
export type SchemaLockFile = {
  /** File-format version. Bump on breaking shape changes. */
  version: typeof SCHEMA_LOCK_VERSION;
  /** Schema id this lock is bound to. */
  schemaId: string;
  /** Embedder id the embeddings were produced with (e.g. `openai:text-embedding-3-small`). */
  embedderId?: string;
  /** Vector dimensions of the stored embeddings. */
  dimensions?: number;
  /** Identity of the store the embeddings were written to (from `VectorStore.describe()`). */
  store?: { kind: string; location?: string };
  /** chunkId → SHA-256 content hash of the chunk's text. */
  hashes: Record<string, string>;
  /** ISO 8601 timestamp of last successful index. */
  updatedAt?: string;
};

/** Result of {@link inspectLockFile}. */
export type LockFileInspection =
  | { status: "missing" }
  | { status: "invalid" }
  /** Written by an older `@askdb/rag`. `hashes` keys are that version's chunk ids. */
  | { status: "outdated"; version: unknown; schemaId?: string; hashes: Record<string, string> }
  | { status: "ok"; lock: SchemaLockFile };

/**
 * Read a lock file of the **current** version. Returns `undefined` when the
 * file is missing, unparseable, or written in an older format.
 */
export function readLockFile(path: string): SchemaLockFile | undefined {
  const inspected = inspectLockFile(path);
  return inspected.status === "ok" ? inspected.lock : undefined;
}

/**
 * Read a lock file and report why it is (un)usable. Used by the indexer to
 * detect older-format locks so it can reindex and clean up old chunk ids.
 */
export function inspectLockFile(path: string): LockFileInspection {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { status: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null) return { status: "invalid" };
  const obj = parsed as Record<string, unknown>;
  const hashes = isStringRecord(obj.hashes) ? obj.hashes : undefined;
  if (obj.version !== SCHEMA_LOCK_VERSION) {
    if (!hashes) return { status: "invalid" };
    return {
      status: "outdated",
      version: obj.version,
      schemaId: typeof obj.schemaId === "string" ? obj.schemaId : undefined,
      hashes,
    };
  }
  if (!hashes || typeof obj.schemaId !== "string") return { status: "invalid" };
  return { status: "ok", lock: parsed as SchemaLockFile };
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

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

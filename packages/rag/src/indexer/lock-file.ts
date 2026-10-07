import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

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
  /** Width of the vectors in the store, learned from the embedder's output. */
  dimensions?: number;
  /** Identity of the store the embeddings were written to (from `VectorStore.describe()`). */
  store?: { kind: string; location?: string };
  /** chunkId → SHA-256 content hash of the chunk's text. */
  hashes: Record<string, string>;
  /** ISO 8601 timestamp of last successful index. */
  updatedAt?: string;
  /**
   * Set while a run that switches the embedder is writing vectors, and
   * cleared when it finishes. A lock that still carries it after the run
   * ended describes a store holding two models' vectors, so it never
   * matches a query (see {@link checkIndexMatches}).
   */
  incomplete?: true;
};

/**
 * Whether two embedder ids name the same embedder. Unset matches only unset:
 * the indexer and {@link checkIndexMatches} share this rule.
 */
export function sameEmbedderId(a: string | undefined, b: string | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

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
    // Only an older lock is "outdated" (its ids get cleaned up). A newer one
    // was written by a later @askdb/rag whose id format this one can't know.
    const older = typeof obj.version === "number" && obj.version < SCHEMA_LOCK_VERSION;
    if (!hashes || !older) return { status: "invalid" };
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
  // Temp file + rename, so a crash never leaves a half-written lock.
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** Result of {@link checkIndexMatches}. */
export type IndexMatch =
  | {
      ok: true;
      /** The lock compared against; `undefined` when there is none for this schema (nothing to check). */
      lock: SchemaLockFile | undefined;
    }
  | {
      ok: false;
      reason: "lock-outdated" | "index-incomplete" | "embedder-changed" | "dimensions-changed";
      message: string;
    };

/**
 * Whether an index described by `schema.lock.json` can be queried with this
 * embedder: the rule `askdb rag query` applies, for any host that queries a
 * persisted index (e.g. through `createRetriever`). The embedder id must be
 * the one the lock records (unset matches only unset, as in the indexer),
 * and when both widths are known they must match. A lock left `incomplete`
 * by an interrupted embedder switch never matches. A missing or unreadable
 * lock, or one for another schema, has nothing to compare and passes.
 */
export function checkIndexMatches(args: {
  lockFilePath: string;
  schemaId: string;
  embedderId: string | undefined;
  dimensions?: number;
}): IndexMatch {
  const inspected = inspectLockFile(args.lockFilePath);
  if (inspected.status === "outdated" && (inspected.schemaId ?? args.schemaId) === args.schemaId) {
    return {
      ok: false,
      reason: "lock-outdated",
      message: "schema.lock.json was written by an older @askdb/rag (unscoped chunk ids); rebuild the index.",
    };
  }
  if (inspected.status !== "ok" || inspected.lock.schemaId !== args.schemaId) {
    return { ok: true, lock: undefined };
  }
  const lock = inspected.lock;
  if (lock.incomplete) {
    return {
      ok: false,
      reason: "index-incomplete",
      message:
        "The last index build switched embedders and didn't finish, so the store holds two models' vectors; rebuild the index.",
    };
  }
  // Equal widths don't make two models' vectors comparable.
  if (!sameEmbedderId(lock.embedderId, args.embedderId)) {
    const built =
      lock.embedderId === undefined
        ? "without an embedder id, so its embedder is unknown,"
        : `with embedder "${lock.embedderId}"`;
    const using = args.embedderId === undefined ? "no embedder id" : `"${args.embedderId}"`;
    return {
      ok: false,
      reason: "embedder-changed",
      message: `The index was built ${built} but this query uses ${using}.`,
    };
  }
  if (lock.dimensions !== undefined && args.dimensions !== undefined && lock.dimensions !== args.dimensions) {
    return {
      ok: false,
      reason: "dimensions-changed",
      message: `The index holds ${lock.dimensions}-dimension embeddings but this query uses ${args.dimensions}.`,
    };
  }
  return { ok: true, lock };
}

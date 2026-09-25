import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ChunkPayload,
  Filter,
  QueryResult,
  UpsertRecord,
  VectorStore,
} from "../types.js";
import { createMemoryStore, type MemoryStore } from "./memory.js";

/**
 * File-backed vector store. Embeddings serialize as a versioned binary file
 * (`*.embeddings.bin`); payload metadata lives next to it as JSON.
 *
 * Behavior matches in-memory exactly — query is cosine over the same Float32
 * vectors. The binary format keeps embeddings compact and round-tripping
 * deterministic across runs.
 *
 * On-disk layout:
 *   `<basePath>.embeddings.bin`     binary header + vectors
 *   `<basePath>.embeddings.json`    payloads + metadata (one JSON file)
 *
 * Format (binary):
 *   magic    4B  "ARAG"
 *   version  4B  uint32 LE — currently 1
 *   dims     4B  uint32 LE
 *   count    4B  uint32 LE
 *   vectors  count * dims * 4B Float32 LE
 *
 * Format (json):
 *   {
 *     "version": 1,
 *     "dimensions": number,
 *     "binSha256"?: string,                 // SHA-256 of the .bin it was written with
 *     "records": [{ id, payload, hash? }]   // same order as binary vectors
 *   }
 *
 * Writes are crash-safe per file: each file is written to a temp path and
 * renamed into place (the `.bin` first, the `.json` last). The `.json` records
 * the SHA-256 of the `.bin` it belongs to, so a crash between the two renames
 * is detected on the next load instead of silently pairing vectors with the
 * wrong payloads.
 */
export type FileStoreOptions = {
  /** Path prefix; the store will write `<prefix>.embeddings.bin` and `<prefix>.embeddings.json`. */
  basePath: string;
  /** Auto-flush after each upsert. Default true. */
  autoFlush?: boolean;
};

export type FileStore = VectorStore & {
  /** Persist current state to disk. */
  flush(): void;
  /** Number of vectors currently held. */
  size(): number;
};

const MAGIC = "ARAG";
const FORMAT_VERSION = 1;

export function createFileStore(options: FileStoreOptions): FileStore {
  const { basePath } = options;
  const autoFlush = options.autoFlush !== false;
  const binPath = `${basePath}.embeddings.bin`;
  const metaPath = `${basePath}.embeddings.json`;

  const memory: MemoryStore = createMemoryStore();
  hydrate(memory, binPath, metaPath);

  const flush = (): void => {
    const snap = memory.snapshot();
    const bin = encodeBinary(snap.records.map((r) => r.vector), snap.dimensions ?? 0);
    const meta = encodeMeta(snap, sha256(bin));
    const suffix = `.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    const binTmp = `${binPath}${suffix}`;
    const metaTmp = `${metaPath}${suffix}`;
    try {
      writeFileSync(binTmp, bin);
      writeFileSync(metaTmp, meta, "utf8");
      renameSync(binTmp, binPath);
      renameSync(metaTmp, metaPath);
    } finally {
      rmSync(binTmp, { force: true });
      rmSync(metaTmp, { force: true });
    }
  };

  return {
    async upsert(records: UpsertRecord[]): Promise<void> {
      await memory.upsert(records);
      if (autoFlush) flush();
    },
    async query(vector: number[], k: number, filter?: Filter): Promise<QueryResult[]> {
      return memory.query(vector, k, filter);
    },
    async delete(ids: string[]): Promise<void> {
      await memory.delete(ids);
      if (autoFlush) flush();
    },
    async hashesByPrefix(prefix: string): Promise<Record<string, string>> {
      return (await memory.hashesByPrefix?.(prefix)) ?? {};
    },
    async idsBySchema(schemaId: string): Promise<string[]> {
      return (await memory.idsBySchema?.(schemaId)) ?? [];
    },
    describe() {
      const { dimensions } = memory.describe?.() ?? {};
      return {
        kind: "file",
        location: resolve(basePath),
        ...(dimensions !== undefined ? { dimensions } : {}),
      };
    },
    flush,
    size() {
      return memory.size();
    },
  };
}

const REINDEX_HINT =
  "The embeddings files are out of sync (likely an interrupted write). " +
  "Delete both files and rebuild the index (e.g. `askdb-rag index <schema-dir>`, or `buildSchemaIndex` with `force: true`).";

function hydrate(memory: MemoryStore, binPath: string, metaPath: string): void {
  const hasBin = existsSync(binPath);
  const hasMeta = existsSync(metaPath);
  if (!hasBin && !hasMeta) return;
  if (hasBin !== hasMeta) {
    throw new Error(
      `File-store incomplete: found ${hasBin ? binPath : metaPath} but not ${hasBin ? metaPath : binPath}. ${REINDEX_HINT}`,
    );
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    version: number;
    dimensions: number;
    binSha256?: string;
    records: { id: string; payload: ChunkPayload; hash?: string }[];
  };
  if (meta.version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported file-store version ${meta.version} at ${metaPath} (expected ${FORMAT_VERSION}).`,
    );
  }
  const buf = readFileSync(binPath);
  if (meta.binSha256 !== undefined && meta.binSha256 !== sha256(buf)) {
    throw new Error(
      `File-store mismatch: ${binPath} does not match the checksum recorded in ${metaPath}. ${REINDEX_HINT}`,
    );
  }
  const { dimensions, count, vectors } = readBinary(buf);
  if (count !== meta.records.length) {
    throw new Error(
      `File-store mismatch: ${binPath} has ${count} vectors but ${metaPath} has ${meta.records.length} records. ${REINDEX_HINT}`,
    );
  }
  if (dimensions !== meta.dimensions) {
    throw new Error(
      `File-store dimension mismatch: bin=${dimensions} json=${meta.dimensions}. ${REINDEX_HINT}`,
    );
  }
  memory.restore({
    dimensions,
    records: meta.records.map((r, i) => ({
      id: r.id,
      vector: vectors[i],
      payload: r.payload,
      hash: r.hash,
    })),
  });
}

function encodeBinary(vectors: Float32Array[], dims: number): Buffer {
  const count = vectors.length;
  const headerSize = 16; // magic(4) + version(4) + dims(4) + count(4)
  const totalSize = headerSize + count * dims * 4;
  const buf = Buffer.alloc(totalSize);

  buf.write(MAGIC, 0, 4, "ascii");
  buf.writeUInt32LE(FORMAT_VERSION, 4);
  buf.writeUInt32LE(dims, 8);
  buf.writeUInt32LE(count, 12);

  let offset = headerSize;
  for (const v of vectors) {
    if (v.length !== dims) {
      throw new Error(
        `Vector dimension mismatch on flush: expected ${dims}, got ${v.length}.`,
      );
    }
    for (let i = 0; i < v.length; i++) {
      buf.writeFloatLE(v[i], offset);
      offset += 4;
    }
  }

  return buf;
}

function readBinary(buf: Buffer): {
  dimensions: number;
  count: number;
  vectors: Float32Array[];
} {
  if (buf.length < 16) throw new Error(`File-store binary too small: ${buf.length} bytes.`);
  const magic = buf.toString("ascii", 0, 4);
  if (magic !== MAGIC) {
    throw new Error(`File-store magic mismatch: expected ${MAGIC}, got ${magic}.`);
  }
  const version = buf.readUInt32LE(4);
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported file-store binary version ${version} (expected ${FORMAT_VERSION}).`,
    );
  }
  const dimensions = buf.readUInt32LE(8);
  const count = buf.readUInt32LE(12);
  const expectedSize = 16 + count * dimensions * 4;
  if (buf.length !== expectedSize) {
    throw new Error(
      `File-store binary size mismatch: expected ${expectedSize}, got ${buf.length}.`,
    );
  }

  const vectors: Float32Array[] = [];
  let offset = 16;
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dimensions);
    for (let j = 0; j < dimensions; j++) {
      v[j] = buf.readFloatLE(offset);
      offset += 4;
    }
    vectors.push(v);
  }
  return { dimensions, count, vectors };
}

function encodeMeta(
  snap: ReturnType<MemoryStore["snapshot"]>,
  binSha256: string,
): string {
  const meta = {
    version: FORMAT_VERSION,
    dimensions: snap.dimensions ?? 0,
    binSha256,
    records: snap.records.map((r) => ({
      id: r.id,
      payload: r.payload,
      hash: r.hash,
    })),
  };
  return JSON.stringify(meta, null, 2) + "\n";
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

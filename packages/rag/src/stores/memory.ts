import type {
  ChunkPayload,
  Filter,
  QueryResult,
  UpsertRecord,
  VectorStore,
} from "../types.js";

/**
 * In-memory cosine-similarity vector store. Zero deps. Default for tests
 * and small schemas. Vectors live in `Float32Array`s for compact storage
 * and faster dot products on the hot path.
 */
export type MemoryStore = VectorStore & {
  /** Number of vectors currently stored (test/diagnostic helper). */
  size(): number;
  /** Snapshot of all records — used by the file-backed store on flush. */
  snapshot(): {
    dimensions: number | undefined;
    records: { id: string; vector: Float32Array; payload: ChunkPayload; hash?: string }[];
  };
  /** Restore from a snapshot — used by the file-backed store on hydrate. */
  restore(snapshot: {
    dimensions?: number;
    records: {
      id: string;
      vector: Float32Array | number[];
      payload: ChunkPayload;
      hash?: string;
    }[];
  }): void;
  /** Attach a content hash to an id (used by the indexer for skip-reembed bookkeeping). */
  setHash(id: string, hash: string): void;
};

export function createMemoryStore(): MemoryStore {
  type StoredRecord = {
    id: string;
    vector: Float32Array;
    payload: ChunkPayload;
    hash?: string;
  };

  const records = new Map<string, StoredRecord>();
  let dimensions: number | undefined;

  const upsert = async (input: UpsertRecord[]): Promise<void> => {
    for (const r of input) {
      const f32 = toFloat32(r.vector);
      if (dimensions === undefined) dimensions = f32.length;
      else if (dimensions !== f32.length) {
        throw new Error(
          `Vector dimension mismatch: expected ${dimensions}, got ${f32.length} for id="${r.id}".`,
        );
      }
      const existing = records.get(r.id);
      records.set(r.id, {
        id: r.id,
        vector: f32,
        payload: r.payload,
        hash: r.hash ?? existing?.hash,
      });
    }
  };

  const query = async (
    vector: number[],
    k: number,
    filter?: Filter,
  ): Promise<QueryResult[]> => {
    const q = toFloat32(vector);
    if (dimensions !== undefined && records.size > 0 && q.length !== dimensions) {
      throw new Error(
        `Query vector dimension mismatch: the store holds ${dimensions}-dimension vectors but the query has ${q.length}. ` +
          "Query with the same embedder (and dimensions) the index was built with, or reindex.",
      );
    }
    const qNorm = norm(q);
    if (qNorm === 0) return [];
    const out: { id: string; score: number; payload: ChunkPayload }[] = [];
    for (const r of records.values()) {
      if (filter && !matchesFilter(r.payload, filter)) continue;
      const rNorm = norm(r.vector);
      if (rNorm === 0) continue;
      const score = dot(q, r.vector) / (qNorm * rNorm);
      out.push({ id: r.id, score, payload: r.payload });
    }
    // Stable sort: score desc, then id asc for deterministic ties.
    out.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    return out.slice(0, Math.max(0, k));
  };

  const del = async (ids: string[]): Promise<void> => {
    for (const id of ids) records.delete(id);
    // An emptied store can accept vectors of a new dimension.
    if (records.size === 0) dimensions = undefined;
  };

  const idsBySchema = async (schemaId: string): Promise<string[]> => {
    const out: string[] = [];
    for (const r of records.values()) {
      if (r.payload.schemaId === schemaId) out.push(r.id);
    }
    return out;
  };

  const hashesByPrefix = async (prefix: string): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const r of records.values()) {
      if (r.hash && r.id.startsWith(prefix)) out[r.id] = r.hash;
    }
    return out;
  };

  return {
    upsert,
    query,
    delete: del,
    hashesByPrefix,
    idsBySchema,
    describe() {
      return dimensions !== undefined ? { kind: "memory", dimensions } : { kind: "memory" };
    },
    size() {
      return records.size;
    },
    snapshot() {
      return {
        dimensions,
        records: Array.from(records.values()).map((r) => ({
          id: r.id,
          vector: r.vector,
          payload: r.payload,
          hash: r.hash,
        })),
      };
    },
    restore(snap) {
      records.clear();
      dimensions = snap.dimensions;
      for (const r of snap.records) {
        records.set(r.id, {
          id: r.id,
          vector: toFloat32(r.vector),
          payload: r.payload,
          hash: r.hash,
        });
      }
    },
    setHash(id, hash) {
      const r = records.get(id);
      if (r) r.hash = hash;
    },
  };
}

function toFloat32(v: number[] | Float32Array): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}.`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function matchesFilter(payload: ChunkPayload, filter: Filter): boolean {
  if (filter.schemaId !== undefined && payload.schemaId !== filter.schemaId) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(payload.type)) return false;
  if (filter.refs && filter.refs.length > 0) {
    const set = new Set(payload.refs);
    if (!filter.refs.some((r) => set.has(r))) return false;
  }
  return true;
}

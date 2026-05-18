import type {
  ChunkPayload,
  ChunkType,
  Filter,
  QueryResult,
  UpsertRecord,
  VectorStore,
} from "../types.js";

/**
 * Minimal `pg`-compatible client shape so this module can stay free of a
 * hard dependency on the `pg` package. Consumers pass either a `pg.Pool`,
 * `pg.Client`, or any object exposing `query(text, params)`.
 */
export type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export type PgvectorIndexStrategy = "ivfflat" | "hnsw" | "none";

export type CreatePgvectorStoreOptions = {
  /**
   * Either a connection string (the adapter lazy-loads `pg`) or a pre-built
   * client. When a client is supplied, the adapter never imports `pg`.
   */
  connectionString?: string;
  client?: PgClient;
  /** Table name to read/write. Default `"askdb_rag_chunks"`. */
  table?: string;
  /** Embedding dimensions. Required — pgvector columns are dimension-typed. */
  dimensions: number;
  /** Index strategy hint, surfaced via the documented DDL helper. Default `"hnsw"`. */
  indexStrategy?: PgvectorIndexStrategy;
};

export type PgvectorStore = VectorStore & {
  /** Documented DDL the consumer must run before first use. */
  setupSql(): string;
  /** Close any pool the adapter built internally. No-op when an external client was supplied. */
  close(): Promise<void>;
  /** Diagnostic helper for hosts that need to verify persisted row counts. */
  count(filter?: Filter): Promise<number>;
};

const DEFAULT_TABLE = "askdb_rag_chunks";

/**
 * pgvector adapter. Follows the same `VectorStore` interface as the other
 * stores; cosine similarity via the `<=>` operator. Index creation is the
 * consumer's responsibility — `setupSql()` returns documented DDL but is
 * **not** auto-run (so accidental `CREATE EXTENSION` in production migrations
 * doesn't surprise anyone).
 */
export function createPgvectorStore(
  options: CreatePgvectorStoreOptions,
): PgvectorStore {
  const table = options.table ?? DEFAULT_TABLE;
  const dimensions = options.dimensions;
  const indexStrategy = options.indexStrategy ?? "hnsw";

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`pgvector store requires positive integer dimensions; got ${dimensions}`);
  }

  let internalPool: { end: () => Promise<void> } | undefined;
  let client: PgClient | undefined = options.client;

  const getClient = async (): Promise<PgClient> => {
    if (client) return client;
    if (!options.connectionString) {
      throw new Error(
        "createPgvectorStore: pass either `client` or `connectionString`.",
      );
    }
    // Lazy-load `pg` so the package stays usable without it for the other stores.
    const pgMod: { Pool: new (cfg: { connectionString: string }) => unknown } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (await import("pg")) as { Pool: new (cfg: { connectionString: string }) => unknown };
    const pool = new pgMod.Pool({ connectionString: options.connectionString }) as PgClient & {
      end: () => Promise<void>;
    };
    internalPool = pool;
    client = pool;
    return pool;
  };

  const upsert = async (records: UpsertRecord[]): Promise<void> => {
    if (records.length === 0) return;
    const c = await getClient();
    // Single round-trip with parameterised UNNEST.
    const ids = records.map((r) => r.id);
    const types = records.map((r) => r.payload.type);
    const texts = records.map((r) => r.payload.text);
    const schemaIds = records.map((r) => r.payload.schemaId);
    const refs = records.map((r) => JSON.stringify(r.payload.refs));
    const sensitives = records.map((r) => r.payload.sensitive);
    const vectors = records.map((r) => formatVector(r.vector));

    const sql = `
      INSERT INTO ${quoteIdent(table)} (id, type, text, schema_id, refs, sensitive, embedding)
      SELECT
        UNNEST($1::text[]),
        UNNEST($2::text[]),
        UNNEST($3::text[]),
        UNNEST($4::text[]),
        UNNEST($5::jsonb[]),
        UNNEST($6::boolean[]),
        UNNEST($7::vector[])
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        text = EXCLUDED.text,
        schema_id = EXCLUDED.schema_id,
        refs = EXCLUDED.refs,
        sensitive = EXCLUDED.sensitive,
        embedding = EXCLUDED.embedding
    `;
    await c.query(sql, [ids, types, texts, schemaIds, refs, sensitives, vectors]);
  };

  const query = async (
    vector: number[],
    k: number,
    filter?: Filter,
  ): Promise<QueryResult[]> => {
    const c = await getClient();
    const wheres: string[] = [];
    const params: unknown[] = [formatVector(vector), Math.max(0, k)];
    let pIdx = 3;
    if (filter?.schemaId !== undefined) {
      wheres.push(`schema_id = $${pIdx++}`);
      params.push(filter.schemaId);
    }
    if (filter?.types && filter.types.length > 0) {
      wheres.push(`type = ANY($${pIdx++}::text[])`);
      params.push(filter.types);
    }
    if (filter?.refs && filter.refs.length > 0) {
      wheres.push(`refs ?| $${pIdx++}::text[]`);
      params.push(filter.refs);
    }
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const sql = `
      SELECT
        id,
        type,
        text,
        schema_id,
        refs,
        sensitive,
        1 - (embedding <=> $1::vector) AS score
      FROM ${quoteIdent(table)}
      ${whereSql}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2
    `;
    const result = await c.query(sql, params);
    return result.rows.map((row) => {
      const r = row as {
        id: string;
        type: ChunkType;
        text: string;
        schema_id: string;
        refs: string[];
        sensitive: boolean;
        score: number;
      };
      const payload: ChunkPayload = {
        id: r.id,
        type: r.type,
        text: r.text,
        schemaId: r.schema_id,
        refs: Array.isArray(r.refs) ? r.refs : [],
        sensitive: r.sensitive,
      };
      return { id: r.id, score: r.score, payload };
    });
  };

  const del = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const c = await getClient();
    await c.query(
      `DELETE FROM ${quoteIdent(table)} WHERE id = ANY($1::text[])`,
      [ids],
    );
  };

  const count = async (filter?: Filter): Promise<number> => {
    const c = await getClient();
    const wheres: string[] = [];
    const params: unknown[] = [];
    if (filter?.schemaId !== undefined) {
      params.push(filter.schemaId);
      wheres.push(`schema_id = $${params.length}`);
    }
    if (filter?.types && filter.types.length > 0) {
      params.push(filter.types);
      wheres.push(`type = ANY($${params.length}::text[])`);
    }
    if (filter?.refs && filter.refs.length > 0) {
      params.push(filter.refs);
      wheres.push(`refs ?| $${params.length}::text[]`);
    }
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    const result = await c.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)} ${whereSql}`,
      params,
    );
    const row = result.rows[0] as { count?: number | string } | undefined;
    const raw = row?.count;
    return typeof raw === "number" ? raw : Number(raw ?? 0);
  };

  const setupSql = (): string => {
    const indexClause =
      indexStrategy === "hnsw"
        ? `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_embedding_hnsw`)} ON ${quoteIdent(table)} USING hnsw (embedding vector_cosine_ops);`
        : indexStrategy === "ivfflat"
          ? `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_embedding_ivfflat`)} ON ${quoteIdent(table)} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`
          : "";
    return [
      `CREATE EXTENSION IF NOT EXISTS vector;`,
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`,
      `  id text PRIMARY KEY,`,
      `  type text NOT NULL,`,
      `  text text NOT NULL,`,
      `  schema_id text NOT NULL,`,
      `  refs jsonb NOT NULL DEFAULT '[]'::jsonb,`,
      `  sensitive boolean NOT NULL DEFAULT false,`,
      `  embedding vector(${dimensions}) NOT NULL`,
      `);`,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_schema_id`)} ON ${quoteIdent(table)} (schema_id);`,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_type`)} ON ${quoteIdent(table)} (type);`,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_refs`)} ON ${quoteIdent(table)} USING gin (refs);`,
      indexClause,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const close = async (): Promise<void> => {
    if (internalPool) {
      await internalPool.end();
      internalPool = undefined;
    }
  };

  const hashesByPrefix = async (prefix: string): Promise<Record<string, string>> => {
    // pgvector store doesn't persist hashes itself — the indexer relies on
    // `schema.lock.json`. Returning empty here means the indexer falls back
    // to its file-based hash bookkeeping, which is the intended path.
    void prefix;
    return {};
  };

  return {
    upsert,
    query,
    delete: del,
    count,
    hashesByPrefix,
    setupSql,
    close,
  };
}

function quoteIdent(name: string): string {
  // Conservative identifier quoting — only allow alnum + underscore.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier for pgvector store: ${name}`);
  }
  return `"${name}"`;
}

function formatVector(v: number[] | Float32Array): string {
  // pgvector text format is `[v1,v2,...]`.
  const arr = v instanceof Float32Array ? Array.from(v) : v;
  return `[${arr.join(",")}]`;
}

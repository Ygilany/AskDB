/**
 * Studio's RAG index on a real pgvector table: config → `@askdb/ai` embedding adapter →
 * `@askdb/rag` pgvector store → Postgres.
 *
 * Protects: Studio creating a new table at the width the embedding model returns (one probe
 * call), keeping that table on rebuilds, using a configured width without a probe, and
 * refusing a table of another width with a 409 before it embeds a chunk.
 * Catches: what the server tests can't see with their fake store: the width read from
 * Postgres, the column type Studio's width produces, and the refusal coming back from the
 * real store.
 *
 * The embedding model is a local OpenAI-compatible server. Skipped unless
 * ASKDB_PGVECTOR_URL is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1, so a missing
 * database fails instead of skipping.
 */
import { cpSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenAskDbConfig, resetAskDbRuntimeForTests, setAskDbRuntimeForTests } from "@askdb/config";
import type { AskDbConfig } from "@askdb/config";
import pg from "pg";
import { afterEach, expect, it } from "vitest";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { createStudioServer } from "./server.js";
import type { RagIndexResponse, RagQueryResponse, StudioRagStatusDto } from "./shared/api.js";

const connectionString = process.env.ASKDB_PGVECTOR_URL ?? process.env.PGVECTOR_URL;
const run = integrationSuite({ env: [["ASKDB_PGVECTOR_URL", "PGVECTOR_URL"]] });
const repoRoot = join(import.meta.dirname, "../../..");

// Studio types `pg` as unknown (src/types/pg.d.ts): it's an optional peer, loaded lazily.
const { Pool } = pg as {
  Pool: new (config: { connectionString?: string }) => {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  };
};

const servers: ReturnType<typeof createServer>[] = [];
const tables: string[] = [];

afterEach(async () => {
  resetAskDbRuntimeForTests();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
  for (const table of tables) await sql(`DROP TABLE IF EXISTS "${table}"`);
  tables.length = 0;
});

run("Studio RAG on pgvector", () => {
  it("creates a new table at the model's width, keeps it on rebuilds, and answers queries", async () => {
    const table = newTable("learn");
    const model = await embeddingModel(4);
    const studio = await startStudio(config(model.baseUrl, table), copySchema());

    const before = await studio.status();
    expect(before).toMatchObject({ hasIndex: false, chunksIndexed: 0, dimensions: null });
    expect(await columnType(table)).toBeUndefined();
    expect(model.requests).toEqual([]);

    const first = await studio.index();
    expect(first.status).toBe(200);
    // One probe for the width, sent without a requested width, then the chunks.
    expect(model.requests[0]).toEqual({ inputs: 1 });
    expect(await columnType(table)).toBe("vector(4)");
    expect(first.body.status).toMatchObject({
      hasIndex: true,
      stale: false,
      dimensions: 4,
      expectedEmbedderId: "ai-sdk:openai:text-embedding-3-small:default",
    });
    expect(await rowCount(table)).toBe(first.body.status.chunksIndexed);

    const rebuilt = await studio.index();
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.status).toMatchObject({ stale: false, dimensions: 4 });
    expect(await columnType(table)).toBe("vector(4)");

    const query = await studio.query("how many users placed orders");
    expect(query.status).toBe(200);
    expect(query.body.results.length).toBeGreaterThan(0);
  });

  it("refuses a table of another width with a 409, before embedding a chunk", async () => {
    const table = newTable("refuse");
    const schemaDir = copySchema();
    const four = await embeddingModel(4);
    expect((await (await startStudio(config(four.baseUrl, table), schemaDir)).index()).status).toBe(200);
    const rows = await rowCount(table);

    // A configured width needs no probe, so the refusal comes before any embedding call.
    const requestsBefore = four.requests.length;
    const requested = await (await startStudio(config(four.baseUrl, table, 6), schemaDir)).index();
    expect(requested.status).toBe(409);
    expect(requested.error).toContain(
      `pgvector table "${table}" holds 4-dimension vectors, but ai.embedding.dimensions asks for 6.`,
    );
    expect(four.requests.length).toBe(requestsBefore);

    // A model that returns another width: only the probe goes out.
    const eight = await embeddingModel(8);
    const switched = await (await startStudio(config(eight.baseUrl, table), schemaDir)).index();
    expect(switched.status).toBe(409);
    expect(switched.error).toContain(
      `pgvector table "${table}" holds 4-dimension vectors, but embedding model text-embedding-3-small returns 8.`,
    );
    expect(eight.requests).toEqual([{ inputs: 1 }]);

    expect(await columnType(table)).toBe("vector(4)");
    expect(await rowCount(table)).toBe(rows);
  });

  it("creates the table at a configured width without a probe call", async () => {
    const table = newTable("sized");
    const model = await embeddingModel(4);
    const studio = await startStudio(config(model.baseUrl, table, 6), copySchema());

    const indexed = await studio.index();
    expect(indexed.status).toBe(200);
    expect(await columnType(table)).toBe("vector(6)");
    expect(indexed.body.status).toMatchObject({ dimensions: 6, expectedEmbedderId: "ai-sdk:openai:text-embedding-3-small:6" });
    expect(model.requests.length).toBeGreaterThan(0);
    expect(model.requests.every((request) => request.dimensions === 6)).toBe(true);
  });
});

function newTable(name: string): string {
  const table = `askdb_studio_${name}_${process.pid}`;
  tables.push(table);
  return table;
}

function config(embeddingBaseUrl: string, table: string, dimensions?: number): AskDbConfig {
  return {
    ai: {
      provider: "openai",
      providerConfig: { openai: { apiKey: "test-key", baseUrl: embeddingBaseUrl } },
      language: { model: "gpt-4o-mini" },
      embedding: { model: "text-embedding-3-small", ...(dimensions !== undefined ? { dimensions } : {}) },
    },
    introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
    rag: {
      embedder: "ai",
      store: "pgvector",
      storeConfig: { pgvector: { databaseUrl: connectionString, table } },
    },
  };
}

/** A fresh copy of the orders-users schema. */
function copySchema(): string {
  const schemaDir = join(mkdtempSync(join(tmpdir(), "askdb-studio-pgvector-")), "orders-users.schema");
  cpSync(join(repoRoot, "fixtures/schemas/orders-users.schema"), schemaDir, { recursive: true });
  return schemaDir;
}

/** A Studio API response: its HTTP status, its body, and the error message when it failed. */
type StudioResult<T> = { status: number; body: T; error: string | undefined };

/** Studio on `schemaDir`, with `structured` as its runtime config. */
async function startStudio(structured: AskDbConfig, schemaDir: string) {
  setAskDbRuntimeForTests({ structured, flat: flattenAskDbConfig(structured) });
  const server = createStudioServer({ schema: schemaDir });
  const baseUrl = await listen(server);
  const headers = { "content-type": "application/json", "x-askdb-studio-token": server.sessionToken ?? "" };
  const post = async <T>(path: string, body: unknown): Promise<StudioResult<T>> => {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const json = (await response.json()) as T & { error?: { message: string } };
    return { status: response.status, body: json, error: json.error?.message };
  };
  return {
    status: async () => (await (await fetch(`${baseUrl}/api/rag/status`, { headers })).json()) as StudioRagStatusDto,
    index: () => post<RagIndexResponse>("/api/rag/index", {}),
    query: (question: string) => post<RagQueryResponse>("/api/rag/query", { question, k: 3 }),
  };
}

/** A local OpenAI-compatible embedding model returning `width`-wide vectors unless a request asks for another width. */
async function embeddingModel(width: number) {
  const requests: { inputs: number; dimensions?: number }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: string[]; dimensions?: number };
    requests.push({ inputs: body.input.length, ...(body.dimensions !== undefined ? { dimensions: body.dimensions } : {}) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: body.input.map((text) => ({ embedding: lexicalVector(text, body.dimensions ?? width) })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    );
  });
  return { baseUrl: await listen(server), requests };
}

function lexicalVector(text: string, width: number): number[] {
  const vector = new Array<number>(width).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) vector[token.length % width]! += 1;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

/** The `embedding` column's type as Postgres reports it, e.g. `vector(4)`; undefined when the table doesn't exist. */
async function columnType(table: string): Promise<string | undefined> {
  const rows = await sql(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a ` +
      `WHERE a.attrelid = to_regclass($1) AND a.attname = 'embedding'`,
    [`"${table}"`],
  );
  return rows[0]?.type as string | undefined;
}

async function rowCount(table: string): Promise<number> {
  return Number((await sql(`SELECT count(*) AS n FROM "${table}"`))[0]?.n);
}

/** Runs one statement against the pgvector database. */
async function sql(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const pool = new Pool({ connectionString });
  try {
    return (await pool.query(text, params)).rows;
  } finally {
    await pool.end();
  }
}

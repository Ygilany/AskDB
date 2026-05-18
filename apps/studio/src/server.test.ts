import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenAskDbConfig, resetAskDbRuntimeForTests, setAskDbRuntimeForTests } from "@askdb/config";
import type { AskDbConfig } from "@askdb/config";
import { createMemoryStore } from "@askdb/rag";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioServer, setStudioPgvectorStoreFactoryForTests } from "./server.js";

const repoRoot = new URL("../../..", import.meta.url).pathname;

const STUDIO_TEST_BASE: AskDbConfig = {
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: "test-key", model: "gpt-4o-mini" },
    },
  },
  database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
};

function installStudioRuntime(
  flatExtra: Record<string, string> = {},
  structured: AskDbConfig = STUDIO_TEST_BASE,
  options?: { omitFlatKeys?: readonly string[] },
): void {
  let flat: Record<string, string> = { ...flattenAskDbConfig(structured), ...flatExtra };
  for (const key of options?.omitFlatKeys ?? []) {
    delete flat[key];
  }
  setAskDbRuntimeForTests({ structured, flat });
}

describe("AskDB Studio server", () => {
  const servers: ReturnType<typeof createStudioServer>[] = [];
  const embeddingServers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    resetAskDbRuntimeForTests();
    setStudioPgvectorStoreFactoryForTests(undefined);
    await Promise.all(
      [...servers, ...embeddingServers].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
    embeddingServers.length = 0;
  });

  it("loads, saves enrichment, and generates sample SQL with the mock model", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const workspace = await getJson(`${baseUrl}/api/workspace`);
    expect(workspace.schemaId).toBe("orders-users");
    expect(workspace.tables.length).toBeGreaterThan(0);

    const users = workspace.tables.find((table: any) => table.physical.name === "users");
    expect(users).toBeTruthy();

    const draft = users.draft;
    draft.description = "Application users who can place orders.";
    draft.aliases = ["customers", "accounts"];
    draft.commonQueryLanguage = "Use customers when the question says buyer.";
    draft.columns[users.physical.columns[0].id].description = "Stable user identifier.";

    const saved = await postJson(`${baseUrl}/api/tables/${encodeURIComponent(users.physical.id)}`, {
      draft,
    });
    expect(saved.tables.find((table: any) => table.physical.id === users.physical.id).draft.description).toBe(
      "Application users who can place orders.",
    );

    const usersMd = join(schemaDir, "tables", "users.md");
    expect(existsSync(usersMd)).toBe(true);
    expect(readFileSync(usersMd, "utf8")).toContain("Application users who can place orders.");

    installStudioRuntime({
      ASKDB_RAG_EMBEDDER: "mock",
      ASKDB_MOCK_SQL: "select count(*) from users",
    });
    const generated = await postJson(`${baseUrl}/api/ask`, {
      question: "How many users are there?",
    });
    expect(generated.sql).toBe("select count(*) from users");

    const initialRag = await getJson(`${baseUrl}/api/rag/status`);
    expect(initialRag.hasIndex).toBe(false);
    expect(initialRag.chunksTotal).toBeGreaterThan(0);

    const ragBeforeIndex = await postRaw(`${baseUrl}/api/ask`, {
      question: "How many users are there?",
      mode: "rag",
    });
    expect(ragBeforeIndex.status).toBe(400);
    await expect(ragBeforeIndex.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("Build the RAG index") },
    });

    const indexed = await postJson(`${baseUrl}/api/rag/index`, {});
    expect(indexed.stats.chunksTotal).toBeGreaterThan(0);
    expect(indexed.status.hasIndex).toBe(true);
    expect(indexed.status.stale).toBe(false);

    const generatedWithRag = await postJson(`${baseUrl}/api/ask`, {
      question: "How many users are there?",
      mode: "rag",
    });
    expect(generatedWithRag.sql).toBe("select count(*) from users");
    expect(generatedWithRag.rag.enabled).toBe(true);
    expect(generatedWithRag.rag.chunks.length).toBeGreaterThan(0);
    expect(generatedWithRag.rag.chunks[0].text).toEqual(expect.any(String));

    const retrieved = await postJson(`${baseUrl}/api/rag/query`, {
      question: "How many users are there?",
      k: 3,
      types: ["table", "column", "cql", "question", "concept"],
    });
    expect(retrieved.results.length).toBeGreaterThan(0);
    expect(retrieved.results[0].text).toEqual(expect.any(String));
  });

  it("keeps Studio on the shared enrichment package instead of the TUI surface", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "apps/studio/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@askdb/enrich"]).toBe("workspace:*");
    expect(packageJson.dependencies?.["@askdb/tui"]).toBeUndefined();
  });

  it("indexes and queries Studio RAG with the OpenAI embedder", async () => {
    const embeddingServer = createEmbeddingServer();
    embeddingServers.push(embeddingServer);
    const embeddingBaseUrl = await listen(embeddingServer);
    installStudioRuntime({
      ASKDB_RAG_EMBEDDER: "openai",
      ASKDB_RAG_EMBEDDER_DIMENSIONS: "4",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: embeddingBaseUrl,
    });

    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/rag/status`);
    expect(status.embedder.kind).toBe("ai-sdk");
    expect(status.embedder.provider).toBe("openai");
    expect(status.embedder.configured).toBe(true);
    expect(status.expectedEmbedderId).toBe("ai-sdk:openai:text-embedding-3-small:4");
    expect(status.expectedDimensions).toBe(4);

    const indexed = await postJson(`${baseUrl}/api/rag/index`, {});
    expect(indexed.status.hasIndex).toBe(true);
    expect(indexed.status.stale).toBe(false);
    expect(indexed.status.dimensions).toBe(4);
    expect(indexed.usage.embeddingTokens).toBeGreaterThan(0);
    expect(indexed.usage.requests[0].kind).toBe("embedding");

    const retrieved = await postJson(`${baseUrl}/api/rag/query`, {
      question: "Which users placed orders?",
      k: 2,
    });
    expect(retrieved.results.length).toBeGreaterThan(0);
    expect(retrieved.results[0].score).toEqual(expect.any(Number));
    expect(retrieved.usage.embeddingTokens).toBeGreaterThan(0);
  });

  it("defaults Studio RAG to AI SDK embeddings when an AI key is configured", async () => {
    installStudioRuntime(
      {
        ASKDB_AI_PROVIDER: "openai",
        ASKDB_AI_API_KEY: "test-key",
        ASKDB_RAG_EMBEDDER_DIMENSIONS: "4",
      },
      STUDIO_TEST_BASE,
      { omitFlatKeys: ["ASKDB_RAG_EMBEDDER"] },
    );

    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/rag/status`);
    expect(status.embedder.kind).toBe("ai-sdk");
    expect(status.embedder.provider).toBe("openai");
    expect(status.embedder.configured).toBe(true);
    expect(status.expectedEmbedderId).toBe("ai-sdk:openai:text-embedding-3-small:4");
    expect(status.embedder.label).toBe("AI SDK (openai)");
  });

  it("uses the configured Azure AI SDK connection for Studio RAG status", async () => {
    const azureStructured: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      ai: {
        provider: "azure",
        providerConfig: {
          azure: {
            apiKey: "test-key",
            baseUrl: "https://example.test/openai/v1",
            model: "embedding-deployment",
          },
        },
      },
    };
    installStudioRuntime(
      {
        ASKDB_RAG_EMBEDDER_DIMENSIONS: "4",
        AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "embedding-deployment",
      },
      azureStructured,
      {
        omitFlatKeys: ["ASKDB_RAG_EMBEDDER"],
      },
    );

    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/rag/status`);
    expect(status.embedder.kind).toBe("ai-sdk");
    expect(status.embedder.provider).toBe("azure");
    expect(status.embedder.configured).toBe(true);
    expect(status.expectedEmbedderId).toBe("ai-sdk:azure:embedding-deployment:4");
    expect(status.embedder.label).toBe("AI SDK (azure)");
  });

  it("surfaces provider details when Studio RAG embedding requests fail", async () => {
    const embeddingServer = createFailingEmbeddingServer();
    embeddingServers.push(embeddingServer);
    const embeddingBaseUrl = await listen(embeddingServer);
    installStudioRuntime({
      ASKDB_RAG_EMBEDDER: "openai",
      ASKDB_RAG_EMBEDDER_DIMENSIONS: "4",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: embeddingBaseUrl,
    });

    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await postRaw(`${baseUrl}/api/rag/index`, {});
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.message).toContain("Studio RAG embedding request failed");
    expect(body.error.message).toContain("provider openai");
    expect(body.error.message).toContain("model text-embedding-3-small");
    expect(body.error.message).toContain("Status: 500");
    expect(body.error.message).toContain("embedding endpoint unavailable");
  });

  it("honors the configured pgvector store for Studio RAG", async () => {
    const backingStore = createMemoryStore();
    setStudioPgvectorStoreFactoryForTests(() => ({
      upsert: backingStore.upsert,
      query: backingStore.query,
      delete: backingStore.delete,
      hashesByPrefix: backingStore.hashesByPrefix,
      count: async (filter) => {
        const snapshot = backingStore.snapshot();
        return snapshot.records.filter((record) =>
          filter?.schemaId ? record.payload.schemaId === filter.schemaId : true,
        ).length;
      },
      setupSql: () => "",
      close: async () => {},
    }));
    const pgvectorStructured: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      rag: {
        embedder: "mock",
        embedderConfig: {},
        store: "pgvector",
        storeConfig: {
          pgvector: {
            databaseUrl: "postgres://pgvector.test/askdb",
            table: "studio_rag_chunks",
            dimensions: 64,
            indexStrategy: "hnsw",
          },
        },
      },
    };
    installStudioRuntime({}, pgvectorStructured);

    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const initialStatus = await getJson(`${baseUrl}/api/rag/status`);
    expect(initialStatus.store.kind).toBe("pgvector");
    expect(initialStatus.store.table).toBe("studio_rag_chunks");
    expect(initialStatus.hasIndex).toBe(false);

    const indexed = await postJson(`${baseUrl}/api/rag/index`, {});
    expect(indexed.status.store.kind).toBe("pgvector");
    expect(indexed.status.store.table).toBe("studio_rag_chunks");
    expect(indexed.status.hasIndex).toBe(true);
    expect(indexed.status.stale).toBe(false);
    expect(indexed.status.files.embeddingsJson).toBe(false);
    expect(indexed.status.files.embeddingsBin).toBe(false);

    const retrieved = await postJson(`${baseUrl}/api/rag/query`, {
      question: "Which users placed orders?",
      k: 2,
    });
    expect(retrieved.results.length).toBeGreaterThan(0);
    expect(retrieved.results[0].score).toEqual(expect.any(Number));
  });
});

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-studio-"));
  const schemaDir = join(dir, "orders-users.schema");
  cpSync(join(repoRoot, "fixtures/schemas/orders-users.schema"), schemaDir, {
    recursive: true,
  });
  return schemaDir;
}

async function listen(server: ReturnType<typeof createStudioServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

function createEmbeddingServer(): ReturnType<typeof createServer> {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/embeddings") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { input?: string[]; dimensions?: number };
    const dim = body.dimensions ?? 4;
    const input = body.input ?? [];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: input.map((text) => ({ embedding: lexicalVector(text, dim) })),
        usage: {
          prompt_tokens: input.reduce((sum, text) => sum + tokenCount(text), 0),
          total_tokens: input.reduce((sum, text) => sum + tokenCount(text), 0),
        },
      }),
    );
  });
}

function createFailingEmbeddingServer(): ReturnType<typeof createServer> {
  return createServer(async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "embedding endpoint unavailable" } }));
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function lexicalVector(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    vector[token.length % dim] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function tokenCount(text: string): number {
  return text.toLowerCase().match(/[a-z0-9_]+/g)?.length ?? 0;
}


async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (response.status !== 200) {
    throw new Error(`GET ${url} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await postRaw(url, body);
  if (response.status !== 200) {
    throw new Error(`Expected 200 from ${url}, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postRaw(url: string, body: unknown): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response;
}

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenAskDbConfig, resetAskDbRuntimeForTests, setAskDbRuntimeForTests } from "@askdb/config";
import type { AskDbConfig } from "@askdb/config";
import { createMemoryStore } from "@askdb/rag";
import { afterEach, describe, expect, it } from "vitest";
import {
  createStudioServer,
  setStudioClientDirForTests,
  setStudioPgvectorStoreFactoryForTests,
} from "./server.js";
import { setSetupInstallerForTests } from "./setup.js";

const repoRoot = new URL("../../..", import.meta.url).pathname;
const BetterSqlite3 = createRequire(import.meta.url)("better-sqlite3") as typeof import("better-sqlite3");

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
    setSetupInstallerForTests(undefined);
    setStudioClientDirForTests(undefined);
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

  describe("request guard", () => {
    async function startGuardedServer() {
      installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
      const server = createStudioServer({ schema: copyFixture() });
      servers.push(server);
      const baseUrl = await listen(server);
      const port = new URL(baseUrl).port;
      return { server, baseUrl, port, token: server.sessionToken };
    }

    it("issues a random 32-byte hex session token per server", async () => {
      const a = await startGuardedServer();
      const b = await startGuardedServer();
      expect(a.token).toMatch(/^[0-9a-f]{64}$/);
      expect(b.token).toMatch(/^[0-9a-f]{64}$/);
      expect(a.token).not.toBe(b.token);
    });

    it("rejects spoofed Host headers (DNS rebinding) on API and static routes", async () => {
      const { baseUrl, port, token } = await startGuardedServer();
      for (const host of [
        `evil.example:${port}`,
        `evil.example`,
        `127.0.0.1:1`,
        `127.0.0.1`,
        `evil@127.0.0.1:${port}`,
        `127.0.0.1:${port}/x`,
      ]) {
        const api = await rawRequest(baseUrl, {
          path: "/api/workspace",
          headers: { host, "x-askdb-studio-token": token },
        });
        expect(api.status, host).toBe(403);
        expect(JSON.parse(api.body).error.message).toContain("Host");
      }
      const page = await rawRequest(baseUrl, { path: "/", headers: { host: `evil.example:${port}` } });
      expect(page.status).toBe(403);
      expect(page.body).not.toContain(token);
    });

    it("accepts localhost, 127.0.0.1, and [::1] Host headers with the right port and token", async () => {
      const { baseUrl, port, token } = await startGuardedServer();
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
        const res = await rawRequest(baseUrl, {
          path: "/api/workspace",
          headers: { host, "x-askdb-studio-token": token },
        });
        expect(res.status, host).toBe(200);
        expect(JSON.parse(res.body).schemaId).toBe("orders-users");
      }
    });

    it("rejects API calls with a missing or wrong session token", async () => {
      const { baseUrl, port, token } = await startGuardedServer();
      const host = `127.0.0.1:${port}`;
      const missing = await rawRequest(baseUrl, { path: "/api/workspace", headers: { host } });
      expect(missing.status).toBe(403);
      expect(JSON.parse(missing.body).error.message).toContain("session token");

      const wrong = await rawRequest(baseUrl, {
        path: "/api/workspace",
        headers: { host, "x-askdb-studio-token": token.replace(/.$/, (c) => (c === "0" ? "1" : "0")) },
      });
      expect(wrong.status).toBe(403);

      const truncated = await rawRequest(baseUrl, {
        path: "/api/setup/status",
        headers: { host, "x-askdb-studio-token": token.slice(0, 10) },
      });
      expect(truncated.status).toBe(403);
    });

    it("rejects the no-cors text/plain exploit and cross-origin writes", async () => {
      const { baseUrl, port, token } = await startGuardedServer();
      const host = `127.0.0.1:${port}`;
      const body = JSON.stringify({ sql: "select 1" });

      // What a malicious page can send with mode: "no-cors": no custom headers, text/plain body.
      const noCors = await rawRequest(baseUrl, {
        method: "POST",
        path: "/api/execute",
        headers: { host, origin: "https://evil.example", "content-type": "text/plain" },
        body,
      });
      expect(noCors.status).toBe(403);

      // Even with a (somehow obtained) token, a foreign Origin is refused.
      for (const origin of ["https://evil.example", `http://evil.example:${port}`, "null", `https://127.0.0.1:${port}`]) {
        const crossOrigin = await rawRequest(baseUrl, {
          method: "POST",
          path: "/api/concepts",
          headers: { host, origin, "content-type": "application/json", "x-askdb-studio-token": token },
          body: JSON.stringify({ concepts: [] }),
        });
        expect(crossOrigin.status, origin).toBe(403);
        expect(JSON.parse(crossOrigin.body).error.message).toContain("cross-origin");
      }

      // A valid token but a non-JSON content type is refused (forces CORS preflight in browsers).
      const textPlain = await rawRequest(baseUrl, {
        method: "POST",
        path: "/api/execute",
        headers: { host, "content-type": "text/plain", "x-askdb-studio-token": token },
        body,
      });
      expect(textPlain.status).toBe(415);

      const noContentType = await rawRequest(baseUrl, {
        method: "POST",
        path: "/api/rag/index",
        headers: { host, "x-askdb-studio-token": token },
        body: "{}",
      });
      expect(noContentType.status).toBe(415);
    });

    it("accepts same-origin JSON writes with the session token", async () => {
      const { baseUrl, port, token } = await startGuardedServer();
      const res = await rawRequest(baseUrl, {
        method: "POST",
        path: "/api/rag/index",
        headers: {
          host: `localhost:${port}`,
          origin: `http://localhost:${port}`,
          "content-type": "application/json; charset=utf-8",
          "x-askdb-studio-token": token,
        },
        body: "{}",
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).status.hasIndex).toBe(true);
    });

    it("injects the session token into the served index.html and forbids framing", async () => {
      const clientDir = mkdtempSync(join(tmpdir(), "askdb-studio-client-"));
      writeFileSync(
        join(clientDir, "index.html"),
        "<!doctype html>\n<html>\n  <head>\n    <title>AskDB Studio</title>\n  </head>\n  <body></body>\n</html>\n",
      );
      setStudioClientDirForTests(clientDir);
      try {
        const { baseUrl, port, token } = await startGuardedServer();
        for (const path of ["/", "/tables/users"]) {
          const page = await rawRequest(baseUrl, { path, headers: { host: `127.0.0.1:${port}` } });
          expect(page.status).toBe(200);
          expect(page.body).toContain(`<meta name="askdb-studio-token" content="${token}" />`);
          expect(page.body.indexOf("askdb-studio-token")).toBeLessThan(page.body.indexOf("</head>"));
          expect(page.headers["x-frame-options"]).toBe("DENY");
        }
      } finally {
        rmSync(clientDir, { recursive: true, force: true });
      }
    });
  });

  it("keeps Studio on the shared enrichment package", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "apps/studio/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@askdb/enrich"]).toBe("workspace:*");
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
      ensureSchema: async () => {},
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

  // ---------------------------------------------------------------------------
  // Execute status and install endpoint tests
  // ---------------------------------------------------------------------------

  it("GET /api/execute/status returns postgres provider when no execute provider is configured", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/execute/status`);
    expect(status.provider).toBe("postgres");
    expect(status.label).toBe("Postgres");
    expect(status.packageName).toBe("pg");
    expect(status.connectionKind).toBe("url");
    expect(typeof status.installed).toBe("boolean");
    expect(typeof status.configured).toBe("boolean");
    expect(status.installCommand).toBe("pnpm add pg");
    // Execute is opt-in: disabled by default, with an explanation for the UI.
    expect(status.enabled).toBe(false);
    expect(status.disabledReason).toContain("studio.execute.enabled");
    expect(status.canInstallFromStudio).toBe(false);
    expect(status.timeoutMs).toBe(30_000);
    expect(status.maxRows).toBe(500);
  });

  it("GET /api/execute/status reports sqlserver provider when introspection is sqlserver", async () => {
    const sqlserverConfig: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      introspection: {
        provider: "sqlserver",
        providerConfig: { sqlserver: { databaseUrl: "Server=localhost;Database=app;" } },
        outputDir: "./askdb/",
      },
      studio: { execute: { enabled: true, useIntrospectionConnection: true } },
    };
    installStudioRuntime({}, sqlserverConfig);
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/execute/status`);
    expect(status.provider).toBe("sqlserver");
    expect(status.label).toBe("SQL Server");
    expect(status.packageName).toBe("mssql");
    expect(status.connectionKind).toBe("url");
    expect(status.configured).toBe(true);
  });

  it("GET /api/execute/status reports sqlite provider with file connection kind", async () => {
    const sqliteConfig: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      introspection: {
        provider: "sqlite",
        providerConfig: { sqlite: { file: "./data/app.db" } },
        outputDir: "./askdb/",
      },
      studio: { execute: { enabled: true, useIntrospectionConnection: true } },
    };
    installStudioRuntime({}, sqliteConfig);
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/execute/status`);
    expect(status.provider).toBe("sqlite");
    expect(status.label).toBe("SQLite");
    expect(status.packageName).toBe("better-sqlite3");
    expect(status.connectionKind).toBe("file");
    expect(status.configured).toBe(true);
  });

  it("GET /api/execute/status reports not configured when no connection URL is set", async () => {
    // postgres provider but no database URL anywhere
    installStudioRuntime({}, {
      ...STUDIO_TEST_BASE,
      introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
    }, { omitFlatKeys: ["ASKDB_INTROSPECT_POSTGRES_URL", "ASKDB_STUDIO_DATABASE_URL"] });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/execute/status`);
    expect(status.provider).toBe("postgres");
    expect(status.configured).toBe(false);
  });

  it("POST /api/execute/install-driver rejects unknown and inherited provider keys with 400", async () => {
    installStudioRuntime({}, { ...STUDIO_TEST_BASE, studio: { execute: { enabled: true } } });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    for (const provider of ["oracle", "constructor", "__proto__", "toString"]) {
      const res = await postRaw(`${baseUrl}/api/execute/install-driver`, { provider });
      expect(res.status, provider).toBe(400);
      expect((await res.json()).error.message).toMatch(/Unknown provider/);
    }
  });

  it("POST /api/execute/install-driver is refused while execute is disabled", async () => {
    installStudioRuntime({});
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await postRaw(`${baseUrl}/api/execute/install-driver`, {});
    expect(res.status).toBe(403);
  });

  it("POST /api/execute returns 403 while execute is disabled (the default)", async () => {
    installStudioRuntime({});
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await postRaw(`${baseUrl}/api/execute`, { sql: "SELECT 1" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("Studio execute is off");
    expect(body.error.message).toContain("studio.execute.enabled: true");
  });

  it("POST /api/execute does not silently reuse the introspection connection", async () => {
    // STUDIO_TEST_BASE's flat map carries an introspection Postgres URL.
    installStudioRuntime(
      { ASKDB_INTROSPECT_POSTGRES_URL: "postgres://introspect-only/db" },
      { ...STUDIO_TEST_BASE, studio: { execute: { enabled: true } } },
    );
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/execute/status`);
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.disabledReason).toContain("useIntrospectionConnection");

    const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT 1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("useIntrospectionConnection");
  });

  it("POST /api/execute returns ok:false when the connection is not configured", async () => {
    installStudioRuntime({}, {
      ...STUDIO_TEST_BASE,
      introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
      studio: { execute: { enabled: true } },
    }, { omitFlatKeys: ["ASKDB_INTROSPECT_POSTGRES_URL", "ASKDB_STUDIO_DATABASE_URL"] });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT 1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No execute connection configured/);
  });

  it("POST /api/execute dispatches to mysql runner when provider is mysql", async () => {
    const mysqlConfig: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      introspection: {
        provider: "mysql",
        providerConfig: { mysql: { databaseUrl: "mysql://unreachable-host/db" } },
        outputDir: "./askdb/",
      },
      studio: { execute: { enabled: true, useIntrospectionConnection: true } },
    };
    installStudioRuntime({}, mysqlConfig);
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    // mysql2 is installed as a dev dep, so the error will be a connection error, not a missing-driver error
    const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT 1" });
    expect(result.ok).toBe(false);
    // The error should come from the mysql runner, not from a missing-pg error
    expect(result.error).not.toMatch(/pg.*required/);
    expect(result.error).not.toMatch(/`pg`/);
  });

  describe("execute against a real SQLite database", () => {
    function createSqliteDb(rows: number): string {
      const dir = mkdtempSync(join(tmpdir(), "askdb-studio-exec-"));
      const file = join(dir, "app.db");
      const db = new BetterSqlite3(file);
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)");
      const insert = db.prepare("INSERT INTO users (email) VALUES (?)");
      for (let i = 0; i < rows; i += 1) insert.run(`user${i}@example.com`);
      db.close();
      return file;
    }

    async function startSqliteServer(file: string, execute: { maxRows?: number } = {}) {
      installStudioRuntime({}, {
        ...STUDIO_TEST_BASE,
        introspection: { provider: "sqlite", providerConfig: { sqlite: {} }, outputDir: "./askdb/" },
        studio: { execute: { enabled: true, provider: "sqlite", file, ...execute } },
      });
      const server = createStudioServer({ schema: copyFixture() });
      servers.push(server);
      return listen(server);
    }

    it("runs a validated SELECT when execute is enabled", async () => {
      const baseUrl = await startSqliteServer(createSqliteDb(3));
      const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT id FROM users ORDER BY id;" });
      expect(result).toMatchObject({
        ok: true,
        columns: ["id"],
        rows: [[1], [2], [3]],
        rowCount: 3,
        truncated: false,
        rowLimit: 500,
      });
      expect(result.warnings).toBeUndefined();
    });

    it("caps rows at studio.execute.maxRows and reports truncated", async () => {
      const baseUrl = await startSqliteServer(createSqliteDb(30), { maxRows: 10 });
      const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT id FROM users ORDER BY id" });
      expect(result.ok).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.rowLimit).toBe(10);
      expect(result.rows).toHaveLength(10);
      expect(result.rowCount).toBe(10);
      expect(result.rows[9]).toEqual([10]);

      const exact = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT id FROM users LIMIT 10" });
      expect(exact.truncated).toBe(false);
      expect(exact.rows).toHaveLength(10);
    });

    it("rejects multi-statement and write SQL with 400 before it reaches the driver", async () => {
      const file = createSqliteDb(2);
      const baseUrl = await startSqliteServer(file);
      for (const sql of ["SELECT 1; DROP TABLE users", "DROP TABLE users", "SELECT 1 -- x"]) {
        const res = await postRaw(`${baseUrl}/api/execute`, { sql });
        expect(res.status, sql).toBe(400);
        expect((await res.json()).error.message).toContain("read-only guardrail");
      }
      // The driver's own multi-statement error would have been a 200 with ok:false.
      const db = new BetterSqlite3(file, { readonly: true });
      expect(db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 2 });
      db.close();
    });

    it("warns (without blocking) when the SQL reads a column marked sensitive", async () => {
      const baseUrl = await startSqliteServer(createSqliteDb(1));
      const result = await postJson(`${baseUrl}/api/execute`, { sql: "SELECT email FROM users" });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([expect.stringContaining("users.email")]);
    });
  });

  it("rejects request bodies over 1 MiB with 413", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const server = createStudioServer({ schema: copyFixture() });
    servers.push(server);
    const baseUrl = await listen(server);
    const big = { question: "x".repeat(1024 * 1024 + 10), mode: "full", sqlMode: "sql-only", sql: "SELECT 1" };

    const declared = await postRaw(`${baseUrl}/api/history`, big);
    expect(declared.status).toBe(413);
    expect((await declared.json()).error.message).toContain("too large");

    // Chunked (no Content-Length) bodies are counted as they stream in.
    const port = new URL(baseUrl).port;
    const chunked = await rawRequest(baseUrl, {
      method: "POST",
      path: "/api/history",
      headers: {
        host: `127.0.0.1:${port}`,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        ...authHeaders(baseUrl),
      },
      body: JSON.stringify(big),
    });
    expect(chunked.status).toBe(413);
  });

  it("persists only whitelisted, bounded history fields and git-ignores the history file", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    await postJson(`${baseUrl}/api/history`, {
      question: "How many users?",
      mode: "full",
      sqlMode: "sql-only",
      sql: "SELECT count(*) FROM users",
      explain: "Counts users.",
      tenantParams: { "1": "t-1" },
      executionResult: { rowCount: 1, durationMs: 3, truncated: false, extra: "dropped" },
      id: "attacker-chosen",
      timestamp: "1999-01-01",
      injected: "x".repeat(10_000),
      __proto__: { polluted: true },
    });
    const stored = JSON.parse(readFileSync(join(schemaDir, "playground-history.json"), "utf8"));
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(
      ["executionResult", "explain", "id", "mode", "question", "sql", "sqlMode", "tenantParams", "timestamp"].sort(),
    );
    expect(stored[0].id).not.toBe("attacker-chosen");
    expect(stored[0].executionResult).toEqual({ rowCount: 1, durationMs: 3, truncated: false });

    const gitignore = readFileSync(join(schemaDir, ".gitignore"), "utf8");
    expect(gitignore.split("\n")).toEqual(expect.arrayContaining(["playground-history.json", ".env", ".env.*", "!.env.example"]));

    for (const bad of [
      { mode: "full", sqlMode: "sql-only", sql: "SELECT 1" },
      { question: "q", mode: "full", sqlMode: "anything", sql: "SELECT 1" },
      { question: "q", mode: "full", sqlMode: "sql-only", sql: 42 },
      { question: "q".repeat(5000), mode: "full", sqlMode: "sql-only", sql: "SELECT 1" },
      { question: "q", mode: "full", sqlMode: "sql-only", sql: "SELECT 1", tenantScope: "not-an-object" },
      { question: "q", mode: "full", sqlMode: "sql-only", sql: "SELECT 1", executionResult: { rowCount: "1" } },
    ]) {
      const res = await postRaw(`${baseUrl}/api/history`, bad);
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
  });

  it("appends the history entry to an existing .gitignore without rewriting it", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const schemaDir = copyFixture();
    writeFileSync(join(schemaDir, ".gitignore"), "# mine\nsecrets.txt");
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const entry = { question: "q", mode: "full", sqlMode: "sql-only", sql: "SELECT 1" };
    await postJson(`${baseUrl}/api/history`, entry);
    await postJson(`${baseUrl}/api/history`, entry);
    const gitignore = readFileSync(join(schemaDir, ".gitignore"), "utf8");
    expect(gitignore.startsWith("# mine\nsecrets.txt\n")).toBe(true);
    expect(gitignore.match(/^playground-history\.json$/gm)).toHaveLength(1);
    expect(gitignore).not.toContain(".env");
  });

  it("GET /api/setup/status reports not needed on a ready workspace", async () => {
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" });
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const status = await getJson(`${baseUrl}/api/setup/status`);
    expect(status.needed).toBe(false);
    expect(status.reason).toBeNull();

    const workspace = await getJson(`${baseUrl}/api/workspace`);
    expect(workspace.dialect).toBe("postgres");
    expect(typeof workspace.schemaPathRelative).toBe("string");
  });

  it("POST /api/introspect resyncs from a prisma source and preserves enrichment files", async () => {
    const prismaConfig: AskDbConfig = {
      ...STUDIO_TEST_BASE,
      introspection: {
        provider: "prisma",
        providerConfig: {
          prisma: { schemaPath: join(repoRoot, "packages/prisma/test-fixtures/simple") },
        },
        outputDir: "./askdb/",
      },
    };
    installStudioRuntime({ ASKDB_RAG_EMBEDDER: "mock" }, prismaConfig);
    const schemaDir = copyFixture();
    const usersMd = join(schemaDir, "tables", "users.md");
    expect(existsSync(usersMd)).toBe(true);

    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const plan = await getJson(`${baseUrl}/api/introspect/status`);
    expect(plan.ok).toBe(true);
    expect(plan.engine).toBe("prisma");

    const result = await postJson(`${baseUrl}/api/introspect`, {});
    expect(result.ok).toBe(true);
    expect(result.engine).toBe("prisma");
    expect(result.tables).toBeGreaterThan(0);
    expect(result.workspace.tables.length).toBeGreaterThan(0);

    // The physical layer was regenerated; the enrichment markdown survives on disk.
    expect(existsSync(usersMd)).toBe(true);
  });

  it("runs the guided setup flow end to end with a prisma source", async () => {
    const projectDir = mkdtempSync(join(repoRoot, "apps/studio/.tmp-setup-"));
    const prevCwd = process.cwd();
    try {
      cpSync(
        join(repoRoot, "packages/prisma/test-fixtures/simple/schema.prisma"),
        join(projectDir, "schema.prisma"),
      );
      process.chdir(projectDir);
      resetAskDbRuntimeForTests();
      // Never run a real package-manager install from tests.
      setSetupInstallerForTests(() => true);

      const server = createStudioServer({ schema: "./askdb", setupReason: "no-config" });
      servers.push(server);
      const baseUrl = await listen(server);

      const status = await getJson(`${baseUrl}/api/setup/status`);
      expect(status).toMatchObject({ needed: true, reason: "no-config" });

      // Non-setup endpoints are gated while setup is pending.
      const gated = await fetch(`${baseUrl}/api/workspace`, { headers: authHeaders(baseUrl) });
      expect(gated.status).toBe(409);

      // Secrets are rejected — env var NAMES only.
      const badKey = await postRaw(`${baseUrl}/api/setup/config`, {
        database: "prisma",
        aiProvider: "openai",
        aiKeyEnv: "sk-this-looks-like-a-secret",
      });
      expect(badKey.status).toBe(400);

      const written = await postJson(`${baseUrl}/api/setup/config`, {
        database: "prisma",
        prismaSchema: "./schema.prisma",
        aiProvider: "openai",
      });
      expect(written.configPath.endsWith("askdb.config.ts")).toBe(true);
      expect(written.envVars.map((v: any) => v.name)).toContain("OPENAI_API_KEY");
      expect(written.status.reason).toBe("no-artifact");
      expect(existsSync(join(projectDir, "askdb.config.ts"))).toBe(true);
      expect(existsSync(join(projectDir, ".env.example"))).toBe(true);

      // Re-writing over an existing config is refused.
      const rewrite = await postRaw(`${baseUrl}/api/setup/config`, {
        database: "prisma",
        aiProvider: "openai",
      });
      expect(rewrite.status).toBe(409);

      const introspected = await postJson(`${baseUrl}/api/setup/introspect`, {});
      expect(introspected.ok).toBe(true);
      expect(introspected.engine).toBe("prisma");
      expect(introspected.tables).toBeGreaterThan(0);
      expect(existsSync(join(projectDir, "askdb", "schema.json"))).toBe(true);

      // The server is now fully ready.
      const workspace = await getJson(`${baseUrl}/api/workspace`);
      expect(workspace.tables.length).toBeGreaterThan(0);
      const readyStatus = await getJson(`${baseUrl}/api/setup/status`);
      expect(readyStatus.needed).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("POST /api/setup/config writes model env, pgvector rag store, and Studio execute settings", async () => {
    const projectDir = mkdtempSync(join(repoRoot, "apps/studio/.tmp-setup-"));
    const prevCwd = process.cwd();
    try {
      cpSync(
        join(repoRoot, "packages/prisma/test-fixtures/simple/schema.prisma"),
        join(projectDir, "schema.prisma"),
      );
      process.chdir(projectDir);
      resetAskDbRuntimeForTests();
      setSetupInstallerForTests(() => true);

      const server = createStudioServer({ schema: "./askdb", setupReason: "no-config" });
      servers.push(server);
      const baseUrl = await listen(server);

      // Studio execute needs an explicit provider when the database is "prisma".
      const missingProvider = await postRaw(`${baseUrl}/api/setup/config`, {
        database: "prisma",
        prismaSchema: "./schema.prisma",
        aiProvider: "foundry",
        studioExecute: true,
      });
      expect(missingProvider.status).toBe(400);

      const written = await postJson(`${baseUrl}/api/setup/config`, {
        database: "prisma",
        prismaSchema: "./schema.prisma",
        aiProvider: "foundry",
        aiModelEnv: "MY_MODEL",
        ragStore: "pgvector",
        pgvectorEnv: "MY_PGVECTOR_URL",
        studioExecute: true,
        studioExecuteProvider: "sqlite",
        studioExecuteSqliteFile: "./studio.db",
      });
      const envNames = written.envVars.map((v: any) => v.name);
      expect(envNames).toContain("AZURE_OPENAI_API_KEY");
      expect(envNames).toContain("MY_MODEL");
      expect(envNames).toContain("MY_PGVECTOR_URL");

      const configContent = readFileSync(join(projectDir, "askdb.config.ts"), "utf8");
      expect(configContent).toContain('provider: "foundry"');
      expect(configContent).toContain('model: env("MY_MODEL")');
      expect(configContent).toContain('store: "pgvector"');
      expect(configContent).toContain('databaseUrl: env("MY_PGVECTOR_URL")');
      expect(configContent).toContain('provider: "sqlite"');
      expect(configContent).toContain('file: "./studio.db"');
      expect(configContent).toContain("enabled: true");
    } finally {
      process.chdir(prevCwd);
      rmSync(projectDir, { recursive: true, force: true });
    }
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

/** Session token per listening base URL, so request helpers can authenticate. */
const sessionTokens = new Map<string, string>();

async function listen(server: ReturnType<typeof createServer> & { sessionToken?: string }): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  if (server.sessionToken) sessionTokens.set(baseUrl, server.sessionToken);
  return baseUrl;
}

function authHeaders(url: string): Record<string, string> {
  const token = sessionTokens.get(new URL(url).origin);
  return token ? { "x-askdb-studio-token": token } : {};
}

/**
 * Raw HTTP request — unlike `fetch`, lets tests send an arbitrary `Host`
 * header (to simulate DNS rebinding).
 */
function rawRequest(
  baseUrl: string,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string; headers: IncomingMessage["headers"] }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname, port, method: options.method ?? "GET", path: options.path, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
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
  const response = await fetch(url, { headers: authHeaders(url) });
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
    headers: { "content-type": "application/json", ...authHeaders(url) },
    body: JSON.stringify(body),
  });
  return response;
}

import {
  flattenAskDbConfig,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
  type AskDbLogLevel,
  type AskDbModeV1,
} from "@askdb/config";
import { afterEach, describe, expect, it } from "vitest";
import { createAskDbHttpServer } from "./server.js";

const schemaPath = new URL("../../../fixtures/schemas/orders-users.schema/", import.meta.url);

const BASE_CONFIG: AskDbConfig = {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "x", model: "gpt-4o-mini" } } },
  database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
};

function installTestRuntime(opts: {
  mockSql?: string;
  logLevel?: AskDbLogLevel;
  host?: { schemaPath?: string; schemaJson?: string };
  modes?: { askdbMode?: AskDbModeV1 };
}): void {
  const structured: AskDbConfig = {
    ...BASE_CONFIG,
    ...(opts.mockSql !== undefined ? { dev: { mockSql: opts.mockSql } } : {}),
    ...(opts.logLevel ? { logging: { level: opts.logLevel } } : {}),
    ...(opts.host ? { host: opts.host } : {}),
    ...(opts.modes ? { modes: opts.modes } : {}),
  };
  setAskDbRuntimeForTests({ structured, flat: flattenAskDbConfig(structured) });
}

describe("http-api", () => {
  afterEach(() => {
    resetAskDbRuntimeForTests();
  });

  it("POST /ask returns sql + correlationId (mocked)", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
    });

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "cid-123",
        },
        body: JSON.stringify({ question: "hi" }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
      expect(json.correlationId).toBe("cid-123");
      expect(json.sql).toBe("select 1");
    } finally {
      await app.close();
    }
  });

  it("POST /ask rejects the old execution header", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
    });

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-askdb-execute": "true" },
        body: JSON.stringify({ question: "hi" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
      expect(json.error?.message).toContain("Execution is not supported");
    } finally {
      await app.close();
    }
  });

  it("GET /health ok", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("unknown routes return not_found", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/nope`);
      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("not_found");
      expect(typeof json.correlationId).toBe("string");
      expect(json.correlationId.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("bad JSON returns bad_request", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
    } finally {
      await app.close();
    }
  });

  it("oversized JSON returns payload_too_large", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0, maxBodyBytes: 32 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "x".repeat(64) }),
      });
      expect(res.status).toBe(413);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("payload_too_large");
    } finally {
      await app.close();
    }
  });

  it("invalid mode returns bad_request", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
      modes: { askdbMode: "schema_only" },
    });

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-askdb-mode": "nope" },
        body: JSON.stringify({ question: "hi" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
    } finally {
      await app.close();
    }
  });

  it("SQL validation errors map to sql_validation_error + rule", async () => {
    installTestRuntime({
      mockSql: "delete from users",
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
    });

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hi" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("sql_validation_error");
      expect(json.error?.rule).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it("missing schema returns bad_request", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
    });

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hi" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
      expect(String(json.error?.message ?? "")).toContain("No schema configured");
    } finally {
      await app.close();
    }
  });
});

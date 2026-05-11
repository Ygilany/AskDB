import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createAskDbHttpServer } from "./server.js";

const schemaPath = new URL("../../../fixtures/schemas/orders-users.schema/", import.meta.url);

describe("http-api", () => {
  afterEach(() => {
    delete process.env.ASKDB_MOCK_SQL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ASKDB_LOG_LEVEL;
    delete process.env.ASKDB_SCHEMA_PATH;
    delete process.env.ASKDB_SCHEMA_JSON;
  });

  it("POST /ask returns sql + correlationId (mocked)", async () => {
    process.env.ASKDB_MOCK_SQL = "select 1";
    process.env.ASKDB_LOG_LEVEL = "silent";
    process.env.ASKDB_SCHEMA_PATH = schemaPath.pathname;

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

  it("POST /ask rejects execution unless explicitly enabled", async () => {
    process.env.ASKDB_MOCK_SQL = "select 1";
    process.env.ASKDB_LOG_LEVEL = "silent";
    delete process.env.ASKDB_HTTP_ENABLE_EXECUTION;
    process.env.ASKDB_SCHEMA_PATH = schemaPath.pathname;

    const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected inet address");

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hi", execute: true }),
      });
      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("execution_disabled");
    } finally {
      await app.close();
    }
  });

  it("GET /health ok", async () => {
    process.env.ASKDB_LOG_LEVEL = "silent";
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
    process.env.ASKDB_LOG_LEVEL = "silent";
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
    process.env.ASKDB_LOG_LEVEL = "silent";
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

  it("invalid mode returns bad_request", async () => {
    process.env.ASKDB_MOCK_SQL = "select 1";
    process.env.ASKDB_LOG_LEVEL = "silent";
    process.env.ASKDB_SCHEMA_PATH = schemaPath.pathname;

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
    process.env.ASKDB_MOCK_SQL = "delete from users";
    process.env.ASKDB_LOG_LEVEL = "silent";
    process.env.ASKDB_SCHEMA_PATH = schemaPath.pathname;

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
    process.env.ASKDB_MOCK_SQL = "select 1";
    process.env.ASKDB_LOG_LEVEL = "silent";
    delete process.env.ASKDB_SCHEMA_PATH;
    delete process.env.ASKDB_SCHEMA_JSON;

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


import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createAskDbHttpServer } from "./server.js";

const schemaPath = new URL("../../../fixtures/schemas/orders-users.schema.json", import.meta.url);

describe("http-api", () => {
  afterEach(() => {
    delete process.env.ASKDB_MOCK_SQL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ASKDB_LOG_LEVEL;
  });

  it("POST /ask returns sql + correlationId (mocked)", async () => {
    process.env.ASKDB_MOCK_SQL = "select 1";
    process.env.ASKDB_LOG_LEVEL = "silent";

    const schemaJson = await readFile(schemaPath, "utf8");
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
        body: JSON.stringify({ question: "hi", schemaJson }),
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
});


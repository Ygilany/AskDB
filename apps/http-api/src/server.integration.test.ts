import {
  flattenAskDbConfig,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
  type AskDbLogLevel,
  type AskDbModeV1,
} from "@askdb/config";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAskDbHttpServer } from "./server.js";

const schemaPath = new URL("../../../fixtures/schemas/orders-users.schema/", import.meta.url);
const sensitiveSchemaPath = new URL("../../../fixtures/schemas/orders-users-sensitive.schema/", import.meta.url);
const tenantSchemaPath = new URL("../../../fixtures/schemas/agency-multi-tenant.schema/", import.meta.url);

const unsupportedProviderSchemaJson = JSON.stringify({
  version: 2,
  schemaId: "test-snowflake",
  provider: "snowflake",
  tables: [
    {
      id: "table:public.users",
      name: "users",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.users#id", name: "id", type: "uuid", nullable: false, primaryKey: true, sensitive: false },
      ],
    },
  ],
});

const BASE_CONFIG: AskDbConfig = {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "x", model: "gpt-4o-mini" } } },
  database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
};

function installTestRuntime(opts: {
  mockSql?: string;
  logLevel?: AskDbLogLevel;
  logFile?: string;
  host?: { schemaPath?: string; schemaJson?: string };
  modes?: { askdbMode?: AskDbModeV1; omitSensitiveFromPrompt?: boolean };
  httpApi?: AskDbConfig["httpApi"];
  /** Point the OpenAI adapter at a local fake provider. */
  openaiBaseUrl?: string;
}): void {
  const structured: AskDbConfig = {
    ...BASE_CONFIG,
    ...(opts.openaiBaseUrl
      ? {
          ai: {
            provider: "openai",
            providerConfig: { openai: { apiKey: "sk-test", model: "gpt-4o-mini", baseUrl: opts.openaiBaseUrl } },
          },
        }
      : {}),
    ...(opts.mockSql !== undefined ? { dev: { mockSql: opts.mockSql } } : {}),
    ...(opts.logLevel ? { logging: { level: opts.logLevel, ...(opts.logFile ? { logFile: opts.logFile } : {}) } } : {}),
    ...(opts.host ? { host: opts.host } : {}),
    ...(opts.modes ? { modes: opts.modes } : {}),
    ...(opts.httpApi ? { httpApi: opts.httpApi } : {}),
  };
  setAskDbRuntimeForTests({ structured, flat: flattenAskDbConfig(structured) });
}

/** Start an AskDB HTTP server on an ephemeral port; returns its base URL and a close fn. */
async function startApp(options: Parameters<typeof createAskDbHttpServer>[0] = {}) {
  const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0, ...options });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("expected inet address");
  return { url: `http://127.0.0.1:${addr.port}`, close: () => app.close() };
}

/**
 * Minimal fake model provider. Records each request body and lets `respond` answer;
 * a `respond` that never writes leaves the request hanging (to exercise timeouts).
 */
async function startFakeProvider(respond: (req: IncomingMessage, res: ServerResponse) => void) {
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    bodies.push(Buffer.concat(chunks).toString("utf8"));
    respond(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected inet address");
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    bodies,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const PROVIDER_SECRET = "sk-live-SECRET-FRAGMENT-1234";

/** 401 is non-retryable in the AI SDK, so the failure surfaces immediately. */
function rejectWithSecret(_req: IncomingMessage, res: ServerResponse): void {
  const body = JSON.stringify({
    error: {
      message: `Incorrect API key provided: ${PROVIDER_SECRET}`,
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
  res.writeHead(401, { "content-type": "application/json" });
  res.end(body);
}

async function postAsk(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
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
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" }, { "x-correlation-id": "cid-123" });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.correlationId).toBe("cid-123");
      expect(json.sql).toBe("select 1");
    } finally {
      await app.close();
    }
  });

  it("prefers schemaPath option over configured ASKDB_SCHEMA_PATH", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      host: { schemaPath: "__missing_http_api_schema__" },
    });
    const app = await startApp({ schemaPath: schemaPath.pathname });
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
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
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" }, { "x-askdb-execute": "true" });
      expect(status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
      expect(json.error?.message).toContain("Execution is not supported");
    } finally {
      await app.close();
    }
  });

  it("GET /health ok", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("unknown routes return not_found", async () => {
    installTestRuntime({ logLevel: "silent" });
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/nope`);
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
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/ask`, {
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
    const app = await startApp({ maxBodyBytes: 32 });
    try {
      const { status, json } = await postAsk(app.url, { question: "x".repeat(64) });
      expect(status).toBe(413);
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
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" }, { "x-askdb-mode": "nope" });
      expect(status).toBe(400);
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
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(400);
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
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("bad_request");
      expect(String(json.error?.message ?? "")).toContain("No schema configured");
    } finally {
      await app.close();
    }
  });

  it("missing schema file returns schema_parse_error with source context", async () => {
    const missingPath = "/nope/does-not-exist-http.schema";
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      host: { schemaPath: missingPath },
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("schema_parse_error");
      expect(String(json.error?.message ?? "")).toContain(`host.schemaPath (${missingPath})`);
    } finally {
      await app.close();
    }
  });

  it("accepts schemaJson override when allowed; unknown provider falls back to postgres", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      httpApi: { allowSchemaOverride: true },
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi", schemaJson: unsupportedProviderSchemaJson });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.sql).toBe("select 1");
    } finally {
      await app.close();
    }
  });

  it("missing AI key with no mock returns generation_not_configured", async () => {
    // apiKey: "" is stripped by flattenAskDbConfig's set() helper, so aiEnv
    // has no OPENAI_API_KEY and createLanguageModelFromEnv returns undefined.
    const noKeyConfig: AskDbConfig = {
      ...BASE_CONFIG,
      ai: { provider: "openai", providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } } },
      host: { schemaPath: schemaPath.pathname },
    };
    setAskDbRuntimeForTests({ structured: noKeyConfig, flat: flattenAskDbConfig(noKeyConfig) });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(500);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("generation_not_configured");
    } finally {
      await app.close();
    }
  });

  it("model provider failures return 502 with a generic message and are logged", async () => {
    const provider = await startFakeProvider(rejectWithSecret);
    const logDir = mkdtempSync(join(tmpdir(), "askdb-http-log-"));
    const logFile = join(logDir, "askdb.log");
    installTestRuntime({
      logLevel: "error",
      logFile,
      host: { schemaPath: schemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" }, { "x-correlation-id": "cid-502" });
      expect(provider.bodies.length).toBeGreaterThan(0);
      expect(status).toBe(502);
      expect(json.ok).toBe(false);
      expect(json.correlationId).toBe("cid-502");
      expect(json.error.code).toBe("sql_generation_error");
      expect(JSON.stringify(json)).not.toContain(PROVIDER_SECRET);
      expect(JSON.stringify(json)).not.toContain("Incorrect API key");

      const runError = readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find((entry) => entry.msg === "askdb http run error");
      expect(runError).toBeDefined();
      expect(runError.correlationId).toBe("cid-502");
      expect(runError.status).toBe(502);
      expect(runError.errName).toBe("SqlGenerationError");
      expect(String(runError.errMessage)).toContain("Incorrect API key");
    } finally {
      await app.close();
      await provider.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("aborts the model call after httpApi.requestTimeoutMs and returns 502", async () => {
    const provider = await startFakeProvider(() => {
      /* never respond */
    });
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
      httpApi: { requestTimeoutMs: 200 },
    });
    const app = await startApp();
    try {
      const started = Date.now();
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(status).toBe(502);
      expect(json.error.code).toBe("sql_generation_error");
      expect(json.error.message).toContain("timed out after 200 ms");
    } finally {
      await app.close();
      await provider.close();
    }
  });

  it("invalid body mode returns bad_request", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    try {
      const bad = await postAsk(app.url, { question: "hi", mode: "nope" });
      expect(bad.status).toBe(400);
      expect(bad.json.error.code).toBe("bad_request");
      expect(bad.json.error.message).toContain("Invalid mode");

      const nonString = await postAsk(app.url, { question: "hi", mode: 42 });
      expect(nonString.status).toBe(400);
      expect(nonString.json.error.code).toBe("bad_request");

      const ok = await postAsk(app.url, { question: "hi", mode: "bounded_results" });
      expect(ok.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("unmapped errors return 500 internal_error with a generic message", async () => {
    // A tenant-policy schema without a tenant scope makes core throw TenantScopeError,
    // which the HTTP API does not map to a caller-facing error.
    installTestRuntime({ mockSql: "select 1", logLevel: "silent" });
    const app = await startApp({ schemaPath: tenantSchemaPath.pathname });
    try {
      const { status, json } = await postAsk(app.url, { question: "how many clients?" });
      expect(status).toBe(500);
      expect(json.error.code).toBe("internal_error");
      expect(json.error.message).toBe("Internal server error. See server logs for this correlationId.");
      expect(typeof json.correlationId).toBe("string");
    } finally {
      await app.close();
    }
  });

  it("config modes.omitSensitiveFromPrompt cannot be loosened by the request", async () => {
    const provider = await startFakeProvider(rejectWithSecret);
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: sensitiveSchemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
      modes: { omitSensitiveFromPrompt: true },
    });
    const app = await startApp();
    try {
      await postAsk(app.url, { question: "list users", omitSensitiveFromPrompt: false });
      expect(provider.bodies.length).toBeGreaterThan(0);
      for (const body of provider.bodies) {
        expect(body).toContain("users");
        expect(body).not.toContain("secret_recovery_token");
      }
    } finally {
      await app.close();
      await provider.close();
    }
  });

  it("sends sensitive identifiers to the model when neither config nor request omits them", async () => {
    const provider = await startFakeProvider(rejectWithSecret);
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: sensitiveSchemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
    });
    const app = await startApp();
    try {
      await postAsk(app.url, { question: "list users" });
      expect(provider.bodies.some((body) => body.includes("secret_recovery_token"))).toBe(true);
    } finally {
      await app.close();
      await provider.close();
    }
  });

  it("returns sensitiveGuardrail when the generated SQL references sensitive columns", async () => {
    installTestRuntime({
      mockSql: "select secret_recovery_token from users",
      logLevel: "silent",
      host: { schemaPath: sensitiveSchemaPath.pathname },
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "list tokens" });
      expect(status).toBe(200);
      expect(json.sensitiveGuardrail?.passed).toBe(false);
      expect(json.sensitiveGuardrail?.references).toEqual(
        expect.arrayContaining([expect.objectContaining({ table: "users", column: "secret_recovery_token" })]),
      );
    } finally {
      await app.close();
    }
  });

  it("rejects per-request schemaJson overrides by default", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi", schemaJson: unsupportedProviderSchemaJson });
      expect(status).toBe(403);
      expect(json.error.code).toBe("schema_override_disabled");

      const nonString = await postAsk(app.url, { question: "hi", schemaJson: { tables: [] } });
      expect(nonString.status).toBe(400);
      expect(nonString.json.error.code).toBe("bad_request");
    } finally {
      await app.close();
    }
  });
});

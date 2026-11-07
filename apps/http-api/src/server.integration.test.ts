import {
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
  type AskDbDialectId,
  type AskDbLogLevel,
  type AskDbModeV1,
} from "@askdb/config";
import { readSchemaDirectory } from "@askdb/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** The Snowflake schema above under another provider, or with none. */
function requestSchemaJson(provider: string | undefined): string {
  const { provider: _snowflake, ...rest } = JSON.parse(unsupportedProviderSchemaJson) as Record<string, unknown>;
  return JSON.stringify({ ...rest, schemaId: "test-request", ...(provider !== undefined ? { provider } : {}) });
}

const BASE_CONFIG: AskDbConfig = {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "x" } }, language: { model: "gpt-4o-mini" } },
  database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
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
  dialect?: AskDbDialectId;
}): void {
  const structured: AskDbConfig = {
    ...BASE_CONFIG,
    ...(opts.openaiBaseUrl
      ? {
          ai: {
            provider: "openai",
            providerConfig: { openai: { apiKey: "sk-test", baseUrl: opts.openaiBaseUrl } },
            language: { model: "gpt-4o-mini" },
          },
        }
      : {}),
    ...(opts.mockSql !== undefined ? { dev: { mockSql: opts.mockSql } } : {}),
    ...(opts.logLevel ? { logging: { level: opts.logLevel, ...(opts.logFile ? { logFile: opts.logFile } : {}) } } : {}),
    ...(opts.host ? { host: opts.host } : {}),
    ...(opts.modes ? { modes: opts.modes } : {}),
    ...(opts.httpApi ? { httpApi: opts.httpApi } : {}),
    ...(opts.dialect ? { dialect: opts.dialect } : {}),
  };
  setAskDbRuntimeForTests(structured);
}

/** Start an AskDB HTTP server on an ephemeral port; returns its base URL and a close fn. */
async function startApp(options: Parameters<typeof createAskDbHttpServer>[0] = {}) {
  const app = createAskDbHttpServer({ host: "127.0.0.1", port: 0, ...options });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("expected inet address");
  return { url: `http://127.0.0.1:${addr.port}`, close: () => app.close() };
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const addr = probe.address();
  if (!addr || typeof addr === "string") throw new Error("expected inet address");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return addr.port;
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

/** Answer an OpenAI Responses API call with `sql` in a fenced block. */
function respondWithSql(sql: string) {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 0,
        model: "gpt-4o-mini",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "message",
            id: "msg_test",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: `\`\`\`sql\n${sql}\n\`\`\``, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      }),
    );
  };
}

/** Parse a JSON-lines log file written by the AskDB logger. */
function readLogEntries(logFile: string): Array<Record<string, unknown>> {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

  it("prefers the schemaPath option over host.schemaPath", async () => {
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

  it("takes port and host from the options, then from httpApi.listen.*", async () => {
    const port = await freePort();
    // Not the default host (127.0.0.1), so the test tells config from default.
    installTestRuntime({ logLevel: "silent", httpApi: { listen: { port, host: "localhost" } } });

    const explicit = createAskDbHttpServer({ port: 0, host: "127.0.0.1" });
    expect({ host: explicit.host, port: explicit.port }).toEqual({ host: "127.0.0.1", port: 0 });

    const app = createAskDbHttpServer();
    await app.listen();
    try {
      expect({ host: app.host, port: app.port }).toEqual({ host: "localhost", port });
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
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
      expect(json.error?.rule).toBe("SQL_NOT_SELECT_OR_WITH");
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

  // #840: the server's own schema is the operator's to fix, so a host.schemaPath that doesn't
  // load is a 500, and its path stays in the server log, never in the response.
  it("a server host.schemaPath that doesn't load answers 500 generation_not_configured, names no path, and logs the cause", async () => {
    const missingPath = "/nope/does-not-exist-http.schema";
    const dir = mkdtempSync(join(tmpdir(), "askdb-http-schema-path-"));
    const logFile = join(dir, "askdb.log");
    installTestRuntime({ mockSql: "select 1", logLevel: "error", logFile, host: { schemaPath: missingPath } });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(500);
      expect(json.ok).toBe(false);
      expect(json.error?.code).toBe("generation_not_configured");
      expect(String(json.error?.message ?? "")).not.toContain("does-not-exist-http");
      const runError = readLogEntries(logFile).find((entry) => entry.msg === "askdb http run error");
      expect(runError?.errName).toBe("SchemaLoadError");
      expect(String(runError?.errMessage)).toContain(`host.schemaPath (${missingPath})`);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts schemaJson override when allowed", async () => {
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "silent",
      httpApi: { allowSchemaOverride: true },
    });
    const app = await startApp();
    try {
      const postgresSchemaJson = JSON.stringify({ ...JSON.parse(unsupportedProviderSchemaJson), provider: "postgres" });
      const { status, json } = await postAsk(app.url, { question: "hi", schemaJson: postgresSchemaJson });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.sql).toBe("select 1");
    } finally {
      await app.close();
    }
  });

  // #720, #809: a request schema answers for its own engine. One whose provider has no AskDB
  // dialect, or that names none, is the caller's to fix: 400, whether or not the server's config
  // sets a dialect, which describes the server's own schema only.
  it.each([
    ["snowflake", undefined, "'snowflake'"],
    ["snowflake", "postgres", "'snowflake'"],
    [undefined, undefined, "no provider"],
    [undefined, "postgres", "no provider"],
  ] as const)(
    "refuses a request schemaJson with provider %s (config dialect %s) with 400 bad_request, and returns no SQL",
    async (provider, dialect, named) => {
      installTestRuntime({ mockSql: "select 1", logLevel: "silent", httpApi: { allowSchemaOverride: true }, ...(dialect ? { dialect } : {}) });
      const app = await startApp();
      try {
        const { status, json } = await postAsk(app.url, { question: "hi", schemaJson: requestSchemaJson(provider) });
        expect(status).toBe(400);
        expect(json.error.code).toBe("bad_request");
        expect(json.error.message).toContain(named);
        // The caller can't edit the server's config, so the message names the ids to send instead.
        expect(json.error.message).not.toContain("askdb.config");
        expect(json.error.message).toContain("postgres, cockroachdb, mysql, mariadb, sqlite, sqlserver");
        expect(json.sql).toBeUndefined();
      } finally {
        await app.close();
      }
    },
  );

  // #809: a request schema's own provider picks the dialect, so the model is asked for MySQL on a
  // server whose config says postgres.
  it("generates SQL for a request schemaJson's own provider, not the server's config dialect", async () => {
    const provider = await startFakeProvider(respondWithSql("SELECT id FROM users"));
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
      httpApi: { allowSchemaOverride: true },
      dialect: "postgres",
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "list users", schemaJson: requestSchemaJson("mysql") });
      expect(status).toBe(200);
      expect(json.sql).toBe("SELECT id FROM users");
      expect(provider.bodies).toHaveLength(1);
      expect(provider.bodies[0]).toContain("Target MySQL.");
      expect(provider.bodies[0]).not.toContain("Target PostgreSQL.");
    } finally {
      await app.close();
      await provider.close();
    }
  });

  // #809: the checks read the SQL the request schema's engine's way too. MySQL reads `#` as a
  // comment, which the read-only check refuses; PostgreSQL, the server's dialect, reads an operator.
  it.each([
    ["the request schemaJson's mysql", requestSchemaJson("mysql"), 400],
    ["the server's own postgres", undefined, 200],
  ] as const)("checks SQL under %s dialect", async (_name, schemaJson, expected) => {
    installTestRuntime({
      mockSql: "SELECT id FROM users # note",
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
      httpApi: { allowSchemaOverride: true },
      dialect: "postgres",
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi", ...(schemaJson ? { schemaJson } : {}) });
      expect(status).toBe(expected);
      if (expected === 400) expect(json.error.code).toBe("sql_validation_error");
    } finally {
      await app.close();
    }
  });

  // #720: the server's own schema is the operator's to fix: 500 generation_not_configured, with a
  // generic message, and the log line names the cause (DialectNotSupportedError, not a missing model).
  it("refuses the server's schema whose provider has no dialect with 500 generation_not_configured, and logs the cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "askdb-http-snowflake-"));
    const schemaDir = join(dir, "snowflake.schema");
    mkdirSync(schemaDir);
    writeFileSync(join(schemaDir, "schema.json"), unsupportedProviderSchemaJson);
    const logFile = join(dir, "askdb.log");
    installTestRuntime({ mockSql: "select 1", logLevel: "error", logFile });
    const app = await startApp({ schemaPath: schemaDir });
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(status).toBe(500);
      expect(json.error.code).toBe("generation_not_configured");
      expect(json.error.message).not.toContain("snowflake");
      expect(json.sql).toBeUndefined();
      const runError = readLogEntries(logFile).find((entry) => entry.msg === "askdb http run error");
      expect(runError?.errName).toBe("DialectNotSupportedError");
      expect(String(runError?.errMessage)).toContain("snowflake");
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a schemaJson override whose table front-matter isn't YAML, and writes no file", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", httpApi: { allowSchemaOverride: true } });
    const dir = mkdtempSync(join(tmpdir(), "askdb-front-matter-"));
    const marker = join(dir, "marker");
    const bundle = readSchemaDirectory(schemaPath.pathname);
    const table = Object.keys(bundle.tables)[0]!;
    const hostile = `---js\n(require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"), {})\n---\nBody.\n`;
    const schemaJson = JSON.stringify({ ...bundle, tables: { ...bundle.tables, [table]: hostile } });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi", schemaJson });
      expect(status).toBe(400);
      expect(json.error?.code).toBe("schema_parse_error");
      expect(existsSync(marker)).toBe(false);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing AI key with no mock returns generation_not_configured", async () => {
    // A blank apiKey resolves to no key, so the language section's connection has none and
    // the client reports the model as not configured.
    const noKeyConfig: AskDbConfig = {
      ...BASE_CONFIG,
      ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } }, language: { model: "gpt-4o-mini" } },
      host: { schemaPath: schemaPath.pathname },
    };
    setAskDbRuntimeForTests(noKeyConfig);
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

      const runError = readLogEntries(logFile).find((entry) => entry.msg === "askdb http run error");
      expect(runError).toBeDefined();
      expect(runError!.correlationId).toBe("cid-502");
      expect(runError!.status).toBe(502);
      expect(runError!.errName).toBe("SqlGenerationError");
      expect(String(runError!.errMessage)).toContain("Incorrect API key");
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

  it("serves a model call under the largest accepted httpApi.requestTimeoutMs", async () => {
    const provider = await startFakeProvider(respondWithSql("SELECT 1"));
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: schemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
      httpApi: { requestTimeoutMs: 2_147_483_647 },
    });
    const app = await startApp();
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" });
      expect(provider.bodies.length).toBe(1);
      expect(status).toBe(200);
      expect(json.sql).toBe("SELECT 1");
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
      expect(nonString.json.error.message).toContain("Invalid mode");

      const blank = await postAsk(app.url, { question: "hi", mode: "" });
      expect(blank.status).toBe(400);
      expect(blank.json.error.code).toBe("bad_request");
      expect(blank.json.error.message).toContain("Invalid mode");

      const ok = await postAsk(app.url, { question: "hi", mode: "bounded_results" });
      expect(ok.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("runs config modes.askdbMode when the request names no mode, and forwards a request mode that tightens it", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "askdb-http-log-"));
    const logFile = join(logDir, "askdb.log");
    installTestRuntime({
      mockSql: "select 1",
      logLevel: "info",
      logFile,
      host: { schemaPath: schemaPath.pathname },
      modes: { askdbMode: "bounded_results" },
    });
    const app = await startApp();
    try {
      const pipelineModes = () =>
        readLogEntries(logFile)
          .filter((entry) => entry.event === "askdb.pipeline.mode")
          .map((entry) => entry.mode);

      expect((await postAsk(app.url, { question: "hi" })).status).toBe(200);
      expect(pipelineModes()).toEqual(["bounded_results"]);

      expect((await postAsk(app.url, { question: "hi" }, { "x-askdb-mode": "schema_only" })).status).toBe(200);
      expect(pipelineModes()).toEqual(["bounded_results", "schema_only"]);
    } finally {
      await app.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("treats JSON null in optional body fields as absent", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    try {
      const ok = await postAsk(app.url, { question: "hi", mode: null, omitSensitiveFromPrompt: null, schemaJson: null });
      expect(ok.status).toBe(200);
      expect(ok.json.sql).toBe("select 1");

      // A null body mode falls through to the header, as an omitted one does.
      const headerMode = await postAsk(app.url, { question: "hi", mode: null }, { "x-askdb-mode": "nope" });
      expect(headerMode.status).toBe(400);
      expect(headerMode.json.error.message).toContain("Invalid mode");
      expect(headerMode.json.error.message).toContain("nope");
    } finally {
      await app.close();
    }
  });

  // `Boolean(body.explain)` used to turn `"false"` into true.
  it("rejects a non-boolean explain with bad_request; true returns explain metadata", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    try {
      for (const explain of ["false", "true", 0, 1]) {
        const { status, json } = await postAsk(app.url, { question: "hi", explain });
        expect(status).toBe(400);
        expect(json.error.code).toBe("bad_request");
        expect(json.error.message).toContain("`explain` must be a boolean");
      }

      const on = await postAsk(app.url, { question: "hi", explain: true });
      expect(on.status).toBe(200);
      expect(on.json.explain).toEqual(expect.any(Object));
      const off = await postAsk(app.url, { question: "hi", explain: null });
      expect(off.status).toBe(200);
      expect(off.json.explain ?? null).toBeNull();
    } finally {
      await app.close();
    }
  });

  // #716: the server can't set a tenant scope (#343), so core refuses a tenant-policy schema before
  // any model call. The code names that, instead of a generic 500 that reads like a crash.
  it("a tenant-policy schema returns 500 tenant_scope_not_configured, and no SQL", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent" });
    const app = await startApp({ schemaPath: tenantSchemaPath.pathname });
    try {
      const { status, json } = await postAsk(app.url, { question: "how many clients?" });
      expect(status).toBe(500);
      expect(json.error.code).toBe("tenant_scope_not_configured");
      expect(json.error.message).toContain("tenant policy");
      expect(json.sql).toBeUndefined();
      expect(typeof json.correlationId).toBe("string");
    } finally {
      await app.close();
    }
  });

  it("an error that escapes the handler returns a JSON 500 and goes to stderr, not a hung request", async () => {
    installTestRuntime({ mockSql: "select 1", logLevel: "silent", host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    // The handler reads the runtime before its own error handling, so a missing one escapes it.
    resetAskDbRuntimeForTests();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { status, json } = await postAsk(app.url, { question: "hi" }, { "x-correlation-id": "cid-escaped" });
      expect(status).toBe(500);
      expect(json).toEqual({
        ok: false,
        correlationId: "cid-escaped",
        error: { code: "internal_error", message: "Internal server error. See server logs for this correlationId." },
      });
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
        "askdb-http: unhandled error (correlationId=cid-escaped): Error: AskDB runtime is not initialized.",
      );
    } finally {
      stderr.mockRestore();
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

  // A string or number used to mean "omit" (Boolean(...)); silently ignoring it would
  // send sensitive column names to the model, so it is rejected before any model call.
  it("rejects a non-boolean omitSensitiveFromPrompt with bad_request before calling the model", async () => {
    const provider = await startFakeProvider(rejectWithSecret);
    installTestRuntime({
      logLevel: "silent",
      host: { schemaPath: sensitiveSchemaPath.pathname },
      openaiBaseUrl: provider.baseUrl,
    });
    const app = await startApp();
    try {
      for (const omitSensitiveFromPrompt of ["true", 1, "false", 0]) {
        const { status, json } = await postAsk(app.url, { question: "list users", omitSensitiveFromPrompt });
        expect(status).toBe(400);
        expect(json.error.code).toBe("bad_request");
        expect(json.error.message).toContain("`omitSensitiveFromPrompt` must be a boolean");
      }
      expect(provider.bodies).toEqual([]);
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

  it("logs requests rejected before the pipeline runs as askdb.run.error with status and code", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "askdb-http-log-"));
    const logFile = join(logDir, "askdb.log");
    installTestRuntime({ mockSql: "select 1", logLevel: "error", logFile, host: { schemaPath: schemaPath.pathname } });
    const app = await startApp();
    try {
      const overrideRejected = await postAsk(
        app.url,
        { question: "hi", schemaJson: unsupportedProviderSchemaJson },
        { "x-correlation-id": "cid-403" },
      );
      expect(overrideRejected.status).toBe(403);
      const badMode = await postAsk(app.url, { question: "hi", mode: "nope" }, { "x-correlation-id": "cid-400" });
      expect(badMode.status).toBe(400);

      const entries = readLogEntries(logFile);
      expect(entries.find((entry) => entry.correlationId === "cid-403")).toMatchObject({
        event: "askdb.run.error",
        status: 403,
        code: "schema_override_disabled",
      });
      expect(entries.find((entry) => entry.correlationId === "cid-400")).toMatchObject({
        event: "askdb.run.error",
        status: 400,
        code: "bad_request",
      });
    } finally {
      await app.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});

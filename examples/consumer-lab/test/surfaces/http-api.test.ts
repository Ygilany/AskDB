/**
 * The installed `@askdb/http-api` server, run as its `askdb-http` bin, as a gateway sees it.
 *
 * Protects the contract in `reference/http-api.mdx` (and `guides/deploy-as-http-service.mdx`):
 * - `http-ask` (every dialect): `POST /ask` answers `200 { ok: true, correlationId, sql, usage }`
 *   with the model's SQL, and the model got the same prompt `createAskDb` builds from the
 *   same config and artifact (reference/config.mdx: the dialect is inferred from the
 *   artifact's recorded provider).
 * - One case per documented error code, with its status and the error shape
 *   `{ ok: false, correlationId, error: { code, message } }` and no `sql`: `not_found` 404,
 *   `bad_request` 400 (malformed JSON, missing `question`), `payload_too_large` 413 (one byte
 *   over the 1 MiB default `maxBodyBytes`, while a body of exactly 1 MiB is accepted),
 *   `schema_override_disabled` 403 (inline `schemaJson` with overrides off, the default),
 *   `schema_parse_error` 400 (inline `schemaJson` on a server that sets
 *   `httpApi.allowSchemaOverride: true`), `sql_validation_error` 400 (a write
 *   statement from the model, with the core rule code), `sql_generation_error` 502 (the
 *   replay model refuses the call) and `generation_not_configured` 500 (a config with no
 *   API key).
 * - `http-correlation-id`: the `x-correlation-id` header is echoed in the body and in the
 *   server's structured log events; without it, each response gets its own id.
 * - `http-health`: `GET /health` answers `200 { ok: true }`.
 * - `http-explain`: `explain: true` returns the guardrail metadata.
 * - `http-tenant-fail-closed`: a schema with `tenant-policy.md` served over HTTP, where the
 *   request has no scope field, fails closed with `500 internal_error`: no SQL, the model is
 *   never called, and the server logs `TenantScopeError` under the correlation id
 *   (`docs/contracts/tenant-policy.md`: "`ask()` requires a valid `tenantScope`").
 * Catches: a packed server that maps an error to the wrong code or status (as the model-call
 * failure did, #299), drops the correlation id, lowers the body limit, picks the
 * wrong dialect for an artifact, or returns SQL for a tenant-policy schema it can't scope.
 * Not covered elsewhere: `apps/http-api/src/server.integration.test.ts` runs workspace
 * source in-process with `createAskDbHttpServer`, never the packed bin, its config
 * bootstrap or a real OpenAI-compatible model over HTTP; the lab's other suites never
 * cross the HTTP transport. The transport, the packed bin and its config loading are the
 * distinct risk here.
 * No production seam: only the documented bin, flags, routes, headers and config; the
 * model is the lab's replay server, reached through the documented `openai` provider's
 * `baseUrl`.
 *
 * Known discrepancy, marked `it.fails`: `explain` is left out instead of `null` when not
 * requested (#285). Over HTTP a tenant-policy schema can only fail closed until the server
 * accepts a scope (#277).
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { ensureArtifact } from "../../src/artifacts.js";
import { needsCapability } from "../../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../../src/dialects.js";
import { postAsk, startHttpServer, type HttpReply, type HttpServer, type HttpServerOptions } from "../../src/http-api.js";
import { CASSETTES_DIR, cassetteSql, loadQuestions, withoutTerminator } from "../../src/model/catalog.js";
import { startReplayServer, type ReplayServer } from "../../src/model/replay-server.js";
import { LAB_ROOT, LAB_STATE } from "../../src/paths.js";

const QUESTIONS = loadQuestions();
const AGENCIES = QUESTIONS.find((q) => q.id === "agency-names")!;
/** A question whose reply is a write statement; only this suite's catalog has it. */
const WRITE = { id: "http-write", text: "Remove every agency from the database." };
const WRITE_REPLY = "```sql\nDELETE FROM org.agency\n```";
/** Not in any catalog, so the replay model refuses the call. */
const UNANSWERED = "Which agency has the most volunteers?";
/** `maxBodyBytes`' documented default, which the bin doesn't let you change. */
const MAX_BODY_BYTES = 1024 * 1024;

mkdirSync(LAB_STATE, { recursive: true });
// Inside the lab, so a scratch project's `@askdb/config` import resolves from its node_modules.
const scratch = mkdtempSync(join(LAB_STATE, "http-api-"));
let replay: ReplayServer;
const started: Promise<HttpServer>[] = [];

/** One server per key, started on first use (after the test's capability gate) and killed in afterAll. */
const servers = new Map<string, Promise<HttpServer>>();
function server(key: string, options: () => HttpServerOptions): Promise<HttpServer> {
  if (!servers.has(key)) {
    const start = startHttpServer(options());
    started.push(start);
    servers.set(key, start);
  }
  return servers.get(key)!;
}

/** The lab's own config, the dialect's artifact, and the replay model for that dialect. */
function labServer(ctx: TestContext, dialect: SupportedDialect): Promise<HttpServer> {
  needsCapability(ctx, "cli-introspect-engine");
  return server(dialect, () => ({ schemaPath: ensureArtifact(dialect), env: { LAB_REPLAY_BASE_URL: replay.baseURL(dialect) } }));
}

beforeAll(async () => {
  // This suite's catalog: the lab's, plus a question whose reply is a write statement.
  writeFileSync(join(scratch, "questions.json"), JSON.stringify([...QUESTIONS, WRITE]));
  cpSync(CASSETTES_DIR, join(scratch, "cassettes"), { recursive: true });
  writeFileSync(join(scratch, "cassettes", "postgres", `${WRITE.id}.json`), JSON.stringify({ question: WRITE.text, reply: WRITE_REPLY, source: "authored" }));
  replay = await startReplayServer({ questionsFile: join(scratch, "questions.json"), cassettesDir: join(scratch, "cassettes") });
});

afterAll(async () => {
  await Promise.all(started.map((s) => s.then((running) => running.close(), () => {})));
  await replay?.close();
  rmSync(scratch, { recursive: true, force: true });
});

function expectSuccess(reply: HttpReply, sql: string): void {
  expect(reply.body).toMatchObject({ ok: true, sql: expect.any(String) });
  expect(withoutTerminator(reply.body.sql)).toBe(sql);
  expect(reply.body.correlationId).toMatch(/\S/);
  // `usage`: `null`, or `{ promptTokens, completionTokens, totalTokens }`, each `number | null`.
  expect(reply.body).toHaveProperty("usage");
  const usage = reply.body.usage;
  if (usage !== null) {
    for (const key of ["promptTokens", "completionTokens", "totalTokens"]) expect([null, "number"]).toContain(usage[key] === null ? null : typeof usage[key]);
  }
  expect(reply.headers.get("content-type")).toMatch(/^application\/json/);
  expect(reply.status).toBe(200);
}

function expectError(reply: HttpReply, status: number, code: string): void {
  expect(reply.body).toMatchObject({ ok: false, error: { code, message: expect.any(String) } });
  expect(reply.body.correlationId).toMatch(/\S/);
  expect(reply.body).not.toHaveProperty("sql");
  expect(reply.status).toBe(status);
}

/** A JSON body padded with trailing whitespace (still valid JSON) to exactly `bytes`. */
function paddedBody(question: string, bytes: number): string {
  const json = JSON.stringify({ question });
  return json + " ".repeat(bytes - Buffer.byteLength(json));
}

/** The replay server's requests whose prompt holds `text`. */
function modelCallsFor(text: string) {
  return replay.requests().filter((r) => r.prompt.includes(text));
}

/** The prompt of the one model call `run` makes, which must reach the replay model for `dialect`. */
async function promptOf(dialect: SupportedDialect, run: () => Promise<unknown>): Promise<string> {
  const before = replay.requests().length;
  await run();
  const calls = replay.requests().slice(before);
  expect(calls.map((c) => c.dialect)).toEqual([dialect]);
  return calls[0]!.prompt;
}

/**
 * The same question through the library, from the same config and artifact: `createAskDb`
 * from `@askdb/client` (reference/client-api.mdx), as a Node host would embed it. The
 * model is passed per call (the documented `model` override), pointed at the dialect's
 * replay URL; the prompt doesn't depend on the model.
 */
function askLibrary(dialect: SupportedDialect, question: string) {
  bootstrapAskDbEnv({ cwd: LAB_ROOT });
  const askdb = createAskDb({ config: getAskDbRuntimeConfig(), providers: [openaiProvider], schema: { path: ensureArtifact(dialect) } });
  const model = createOpenAI({ baseURL: replay.baseURL(dialect), apiKey: "lab-replay-no-key" })("gpt-4o-mini");
  return askdb.ask(question, { model });
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] http-ask", (dialect) => {
  it("POST /ask answers 200 { ok, correlationId, sql, usage } with the model's SQL, from the prompt the library builds", async (ctx) => {
    const http = await labServer(ctx, dialect);
    const question = QUESTIONS.find((q) => q.id === "top-paid-agencies")!;
    let reply!: HttpReply;
    const httpPrompt = await promptOf(dialect, async () => (reply = await postAsk(http, { question: question.text })));

    expectSuccess(reply, cassetteSql(dialect, question.id));
    // Same config and artifact, so the same prompt: the server resolves the dialect, mode
    // and prompt options as the library does.
    expect(httpPrompt).toBe(await promptOf(dialect, () => askLibrary(dialect, question.text)));
  });
});

describe("[postgres]", () => {
  it("http-health: GET /health answers 200 { ok: true }", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const res = await fetch(`${http.url}/health`);

    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
  });

  it("http-not-found: an unknown route answers 404 not_found", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const res = await fetch(`${http.url}/v1/ask`, { method: "POST", body: "{}" });

    expectError({ status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> }, 404, "not_found");
  });

  it("http-bad-request: malformed JSON answers 400 bad_request", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expectError(await postAsk(http, `{"question": "${AGENCIES.text}"`), 400, "bad_request");
  });

  it("http-bad-request: a body without `question` answers 400 bad_request", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expectError(await postAsk(http, { mode: "schema_only" }), 400, "bad_request");
  });

  it("http-payload-too-large: a body one byte over the 1 MiB default answers 413 payload_too_large", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expectError(await postAsk(http, paddedBody(AGENCIES.text, MAX_BODY_BYTES + 1)), 413, "payload_too_large");
  });

  it("http-payload-too-large: a body of exactly 1 MiB is answered", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expectSuccess(await postAsk(http, paddedBody(AGENCIES.text, MAX_BODY_BYTES)), cassetteSql("postgres", AGENCIES.id));
  });

  it("http-schema-override-disabled: an inline schemaJson answers 403 schema_override_disabled by default", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expectError(await postAsk(http, { question: AGENCIES.text, schemaJson: '{"version":2,' }), 403, "schema_override_disabled");
  });

  it("http-schema-parse-error: with httpApi.allowSchemaOverride, an inline schemaJson that isn't JSON answers 400 schema_parse_error", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const http = await server("schema-override", () => {
      const project = join(scratch, "schema-override");
      mkdirSync(project);
      writeFileSync(
        join(project, "askdb.config.ts"),
        `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "lab-replay-no-key" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
  httpApi: { allowSchemaOverride: true },
});
`,
      );
      return { cwd: project, schemaPath: ensureArtifact("postgres") };
    });

    expectError(await postAsk(http, { question: AGENCIES.text, schemaJson: '{"version":2,' }), 400, "schema_parse_error");
  });

  it("http-validation-error: a write statement from the model answers 400 sql_validation_error with its rule code", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const reply = await postAsk(http, { question: WRITE.text });

    // The model did answer; AskDB rejected its SQL.
    expect(modelCallsFor(WRITE.text).at(-1)).toMatchObject({ questionId: WRITE.id, error: null });
    expectError(reply, 400, "sql_validation_error");
    // The core rule code (getting-started/troubleshooting.mdx). The docs site's example shows `read_only` (#285).
    expect(reply.body.error.rule).toBe("SQL_NOT_SELECT_OR_WITH");
  });

  it("http-generation-error: a failed model call answers 502 sql_generation_error (#299)", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const reply = await postAsk(http, { question: UNANSWERED });

    // The replay model received the call and refused it.
    expect(modelCallsFor(UNANSWERED).at(-1)?.error).toMatch(/contains none of the/);
    expectError(reply, 502, "sql_generation_error");
  });

  it("http-not-configured: with no model provider configured, answers 500 generation_not_configured", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const http = await server("not-configured", () => {
      const project = join(scratch, "no-model");
      mkdirSync(project);
      writeFileSync(
        join(project, "askdb.config.ts"),
        `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
});
`,
      );
      return { cwd: project, schemaPath: ensureArtifact("postgres") };
    });

    expectError(await postAsk(http, { question: AGENCIES.text }), 500, "generation_not_configured");
  });

  it("http-correlation-id: the x-correlation-id header is echoed in the response and in the server's log events", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const id = `lab-http-${randomUUID()}`;
    const reply = await postAsk(http, { question: AGENCIES.text }, { "x-correlation-id": id });

    expect(reply.body.correlationId).toBe(id);
    await expect.poll(() => http.output()).toContain(`"correlationId":"${id}"`);
  });

  it("http-correlation-id: without the header, each response carries its own generated id", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const [a, b] = await Promise.all([postAsk(http, { question: AGENCIES.text }), postAsk(http, {})]);

    expect(a.body.correlationId).toMatch(/\S/);
    expect(b.body.correlationId).toMatch(/\S/);
    expect(a.body.correlationId).not.toBe(b.body.correlationId);
  });

  it("http-explain: explain: true returns the guardrail metadata object", async (ctx) => {
    const http = await labServer(ctx, "postgres");
    const reply = await postAsk(http, { question: AGENCIES.text, explain: true });

    expectSuccess(reply, cassetteSql("postgres", AGENCIES.id));
    expect(reply.body.explain).toEqual(expect.any(Object));
  });

  it.fails("http-explain: explain is null when it wasn't requested (#285)", async (ctx) => {
    const http = await labServer(ctx, "postgres");

    expect((await postAsk(http, { question: AGENCIES.text })).body.explain).toBeNull();
  });

  it("http-tenant-fail-closed: a tenant-policy schema over HTTP, which has no scope field, returns no SQL and never calls the model", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const tenant = await server("tenant", () => {
      const schema = join(scratch, "tenant.schema");
      cpSync(ensureArtifact("postgres"), schema, { recursive: true });
      // docs/contracts/tenant-policy.md: stable ids from the artifact's schema.json.
      writeFileSync(
        join(schema, "tenant-policy.md"),
        `---
schemaId: multi-engine
enforcement: strict
roots:
  - id: table:org.agency
    tenantIdColumn: table:org.agency#agency_id
    label: Agency
scopedTables:
  - id: table:billing.order
    scopeThrough:
      - root: table:org.agency
        column: table:billing.order#agency_id
---

# Tenancy

Every order belongs to one agency.
`,
      );
      return { schemaPath: schema, env: { LAB_REPLAY_BASE_URL: replay.baseURL("postgres") } };
    });
    const before = modelCallsFor(AGENCIES.text).length;
    const id = `lab-tenant-${randomUUID()}`;
    const reply = await postAsk(tenant, { question: AGENCIES.text }, { "x-correlation-id": id });

    // reference/http-api.mdx: the HTTP API can't supply a tenantScope, so ask() throws
    // TenantScopeError, which answers a generic 500 and is logged under the correlation id.
    expectError(reply, 500, "internal_error");
    await expect.poll(() => tenant.output()).toMatch(new RegExp(`"correlationId":"${id}"[^\\n]*"errName":"TenantScopeError"`));
    expect(modelCallsFor(AGENCIES.text)).toHaveLength(before);

    // Control: the same artifact without the policy answers, and that call reaches the model.
    expectSuccess(await postAsk(await labServer(ctx, "postgres"), { question: AGENCIES.text }), cassetteSql("postgres", AGENCIES.id));
    expect(modelCallsFor(AGENCIES.text)).toHaveLength(before + 1);
  });
});

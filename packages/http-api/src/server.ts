import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNodeServer } from "node:http";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  DEFAULT_ASKDB_MODE,
  SqlExecutionError,
  SqlGenerationError,
  SqlValidationError,
  ask,
  createAskDbLogger,
  loadNormalizedSchemaFromJson,
  parseAskDbModeV1,
} from "@askdb/core";
import type { AskHttpErrorResponse, AskHttpRequest, AskHttpSuccessResponse } from "./types.js";

export type AskDbHttpServerOptions = {
  /** Default: 3000 */
  port?: number;
  /** Default: 127.0.0.1 */
  host?: string;
};

function resolveAskDbLogLevelFromEnv(): AskDbLogLevel {
  const env = process.env.ASKDB_LOG_LEVEL?.toLowerCase();
  if (
    env === "trace" ||
    env === "debug" ||
    env === "info" ||
    env === "warn" ||
    env === "error" ||
    env === "fatal" ||
    env === "silent"
  ) {
    return env;
  }
  return "info";
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(json));
  res.end(json);
}

function writeError(
  res: ServerResponse,
  status: number,
  correlationId: string,
  error: AskHttpErrorResponse["error"],
): void {
  writeJson(res, status, { ok: false, correlationId, error } satisfies AskHttpErrorResponse);
}

function getCorrelationId(req: IncomingMessage): string {
  const h = req.headers["x-correlation-id"];
  if (typeof h === "string" && h.trim() !== "") return h.trim();
  return randomUUID();
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function badRequest(correlationId: string, message: string): AskHttpErrorResponse {
  return { ok: false, correlationId, error: { code: "bad_request", message } };
}

function resolveSchemaJsonFromEnv(): { schemaJson?: string; source?: string } {
  const inline = process.env.ASKDB_SCHEMA_JSON;
  if (typeof inline === "string" && inline.trim() !== "") {
    return { schemaJson: inline, source: "ASKDB_SCHEMA_JSON" };
  }
  const p = process.env.ASKDB_SCHEMA_PATH;
  if (typeof p === "string" && p.trim() !== "") {
    return { schemaJson: undefined, source: `ASKDB_SCHEMA_PATH (${p})` };
  }
  return { schemaJson: undefined, source: undefined };
}

async function readSchemaFileWithFallbacks(schemaPath: string): Promise<{ raw: string; source: string }> {
  const trimmed = schemaPath.trim();
  const attempted: string[] = [];

  // 1) As provided (absolute or relative to current working directory)
  attempted.push(trimmed);
  try {
    const raw = await readFile(trimmed, "utf8");
    return { raw, source: `ASKDB_SCHEMA_PATH (${trimmed})` };
  } catch (e) {
    const err = e as any;
    if (err?.code !== "ENOENT" || isAbsolute(trimmed)) throw e;
  }

  // 2) If relative, also try resolving relative to the repo root (3 levels up from this file).
  // Works for both `src/` and compiled `dist/` layouts:
  // - .../packages/http-api/src/server.ts  -> repo root is ../../..
  // - .../packages/http-api/dist/server.js -> repo root is ../../..
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolvePath(here, "../../..");
  const repoRelative = resolvePath(repoRoot, trimmed);
  attempted.push(repoRelative);
  const raw = await readFile(repoRelative, "utf8");
  return { raw, source: `ASKDB_SCHEMA_PATH (${trimmed}) resolved from repo root (${repoRelative})` };
}

function boolFromHeader(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return undefined;
}

function modeFromHeader(v: string | undefined): AskDbModeV1 | undefined {
  if (!v) return undefined;
  return parseAskDbModeV1(v);
}

export function createAskDbHttpServer(options: AskDbHttpServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  let cachedSchema: ReturnType<typeof loadNormalizedSchemaFromJson> | undefined;
  let cachedSchemaSource: string | undefined;

  const server = createNodeServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const correlationId = getCorrelationId(req);

    if (method === "GET" && url === "/health") {
      writeJson(res, 200, { ok: true });
      return;
    }

    if (method !== "POST" || url !== "/ask") {
      writeError(res, 404, correlationId, { code: "not_found", message: "not found" });
      return;
    }

    const logger = createAskDbLogger({
      correlationId,
      level: resolveAskDbLogLevelFromEnv(),
      logFile: process.env.ASKDB_LOG_FILE,
      logStdout: ["1", "true", "yes"].includes((process.env.ASKDB_LOG_STDOUT ?? "").toLowerCase()),
    });

    let body: AskHttpRequest;
    try {
      body = await readJsonBody<AskHttpRequest>(req);
    } catch (e) {
      logger.error(
        { event: AskDbLogEvent.RunError, errMessage: e instanceof Error ? e.message : String(e) },
        "invalid JSON body",
      );
      writeError(res, 400, correlationId, badRequest(correlationId, "invalid JSON body").error);
      return;
    }

    if (!body || typeof body !== "object") {
      writeError(res, 400, correlationId, badRequest(correlationId, "request body must be an object").error);
      return;
    }
    if (typeof body.question !== "string" || body.question.trim() === "") {
      writeError(res, 400, correlationId, badRequest(correlationId, "`question` is required").error);
      return;
    }

    try {
      // Mode may be supplied by request JSON or header; JSON wins.
      const headerMode = getHeader(req, "x-askdb-mode");
      const effectiveMode = body.mode ?? (headerMode ? modeFromHeader(headerMode) : undefined);
      const mode: AskDbModeV1 = effectiveMode ?? parseAskDbModeV1(process.env.ASKDB_MODE);

      // Default to generation+validation only. Execution must be explicitly enabled both:
      // - by the request, and
      // - by server config (ASKDB_HTTP_ENABLE_EXECUTION).
      const headerExecute = boolFromHeader(getHeader(req, "x-askdb-execute"));
      const requestExecute = body.execute ?? headerExecute ?? false;
      const executionEnabled =
        ["1", "true", "yes"].includes((process.env.ASKDB_HTTP_ENABLE_EXECUTION ?? "").toLowerCase()) ||
        false;
      if (requestExecute && !executionEnabled) {
        writeError(res, 403, correlationId, {
          code: "execution_disabled",
          message: "Execution is disabled on this server.",
        });
        return;
      }

      const mockSql = process.env.ASKDB_MOCK_SQL;
      const apiKey = process.env.OPENAI_API_KEY;
      if (!mockSql && !apiKey) {
        writeError(res, 500, correlationId, {
          code: "generation_not_configured",
          message: "OPENAI_API_KEY is required for NL→SQL generation (or set ASKDB_MOCK_SQL).",
        });
        return;
      }

      logger.info(
        { event: AskDbLogEvent.RunStart, execute: requestExecute, mode },
        "askdb http run start",
      );

      let schema;
      try {
        // Prefer request override, otherwise use the server-default schema (cached).
        const requestOverride =
          typeof body.schemaJson === "string" && body.schemaJson.trim() !== "" ? body.schemaJson : undefined;
        if (requestOverride) {
          schema = loadNormalizedSchemaFromJson(requestOverride);
        } else {
          if (!cachedSchema) {
            const env = resolveSchemaJsonFromEnv();
            cachedSchemaSource = env.source;
            if (env.schemaJson) {
              cachedSchema = loadNormalizedSchemaFromJson(env.schemaJson);
            } else if (process.env.ASKDB_SCHEMA_PATH && process.env.ASKDB_SCHEMA_PATH.trim() !== "") {
              const { raw, source } = await readSchemaFileWithFallbacks(process.env.ASKDB_SCHEMA_PATH);
              cachedSchemaSource = source;
              cachedSchema = loadNormalizedSchemaFromJson(raw);
            } else {
              writeError(res, 400, correlationId, {
                code: "bad_request",
                message:
                  "No schema configured. Provide `schemaJson` in the request body or set ASKDB_SCHEMA_PATH / ASKDB_SCHEMA_JSON on the server.",
              });
              return;
            }
          }
          schema = cachedSchema;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const prefix = cachedSchemaSource ? `schema parse error (${cachedSchemaSource}): ` : "schema parse error: ";
        writeError(res, 400, correlationId, { code: "schema_parse_error", message: `${prefix}${msg}` });
        return;
      }

      type AskModel = Parameters<typeof ask>[0]["model"];
      const model: AskModel = mockSql
        ? (undefined as unknown as AskModel)
        : (() => {
            const openai = createOpenAI({
              apiKey: apiKey!,
              baseURL: process.env.OPENAI_BASE_URL,
            });
            const modelId = process.env.ASKDB_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
            return openai(modelId);
          })();

      const out = await ask({
        question: body.question,
        schema,
        model,
        execute: requestExecute,
        connectionString: body.connectionString,
        logger,
        mode: mode ?? DEFAULT_ASKDB_MODE,
        explain: Boolean(body.explain),
        omitSensitiveIdentifiersFromNlToSqlPrompt: Boolean(body.omitSensitiveFromPrompt),
        deps:
          mockSql !== undefined
            ? {
                generateText: (async () => ({ text: mockSql } as any)) as any,
              }
            : undefined,
      });

      const payload: AskHttpSuccessResponse = {
        ok: true,
        correlationId,
        sql: out.sql,
        result: out.result,
        explain: out.explain,
      };
      logger.info({ event: AskDbLogEvent.RunEnd, ok: true }, "askdb http run end");
      writeJson(res, 200, payload);
      return;
    } catch (e) {
      // parseAskDbModeV1 throws on invalid ids; treat as caller error if it looks like a mode issue.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("mode")) {
        writeError(res, 400, correlationId, badRequest(correlationId, msg).error);
        return;
      }
      logger.error({ event: AskDbLogEvent.RunError, errMessage: msg }, "askdb http run error");

      if (e instanceof SqlValidationError) {
        writeError(res, 400, correlationId, {
          code: "sql_validation_error",
          message: e.message,
          rule: e.rule,
        });
        return;
      }
      if (e instanceof SqlGenerationError) {
        writeError(res, 502, correlationId, { code: "sql_generation_error", message: e.message });
        return;
      }
      if (e instanceof SqlExecutionError) {
        writeError(res, 502, correlationId, { code: "sql_execution_error", message: e.message });
        return;
      }
      if (e instanceof AskDbError) {
        // Default mapping for other core errors.
        writeError(res, 500, correlationId, { code: "internal_error", message: e.message });
        return;
      }

      writeError(res, 500, correlationId, { code: "internal_error", message: msg });
      return;
    }
  });

  return {
    host,
    port,
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.listen(port, host, () => resolve());
        server.once("error", reject);
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}


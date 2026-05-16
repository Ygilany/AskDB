import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNodeServer } from "node:http";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  type AskDialectInput,
  type BuiltInDialectId,
  DEFAULT_ASKDB_MODE,
  isBuiltInDialectId,
  SqlGenerationError,
  SqlValidationError,
  ask,
  askDbAiKeyMissingMessage,
  createAskDbLanguageModelFromEnv,
  createAskDbLogger,
  loadSchema,
  loadSchemaFromJson,
  parseAskDbModeV1,
  resolveAskDbAiConfig,
} from "@askdb/core";
import type { AskHttpErrorResponse, AskHttpRequest, AskHttpSuccessResponse } from "./types.js";

export type AskDbHttpServerOptions = {
  /** Default: 3000 */
  port?: number;
  /** Default: 127.0.0.1 */
  host?: string;
  /** Default: 1 MiB */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`request body exceeds ${limitBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

function resolveAskDbLogLevelFromRt(rt: ReturnType<typeof getAskDbRuntimeConfig>): AskDbLogLevel {
  const env = rt.logging.level?.toLowerCase();
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

async function readJsonBody<T>(req: IncomingMessage, maxBodyBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += chunk.byteLength;
    if (total > maxBodyBytes) {
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }
    chunks.push(chunk);
  }
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

function resolveSchemaJsonFromRt(rt: ReturnType<typeof getAskDbRuntimeConfig>): {
  schemaJson?: string;
  source?: string;
} {
  const inline = rt.ai.aiEnv.ASKDB_SCHEMA_JSON;
  if (typeof inline === "string" && inline.trim() !== "") {
    return { schemaJson: inline, source: "ASKDB_SCHEMA_JSON" };
  }
  const p = rt.ai.aiEnv.ASKDB_SCHEMA_PATH;
  if (typeof p === "string" && p.trim() !== "") {
    return { schemaJson: undefined, source: `ASKDB_SCHEMA_PATH (${p})` };
  }
  return { schemaJson: undefined, source: undefined };
}

async function resolveSchemaPathWithFallbacks(schemaPath: string): Promise<{ resolvedPath: string; source: string }> {
  const trimmed = schemaPath.trim();

  // 1) As provided (absolute or relative to current working directory)
  if (isAbsolute(trimmed)) {
    return { resolvedPath: trimmed, source: `ASKDB_SCHEMA_PATH (${trimmed})` };
  }

  // 2) Relative to CWD — accept both files and directories
  if (existsSync(trimmed)) {
    return { resolvedPath: trimmed, source: `ASKDB_SCHEMA_PATH (${trimmed})` };
  }

  // 3) If relative, also try resolving relative to the repo root (3 levels up from this file).
  // Works for both `src/` and compiled `dist/` layouts:
  // - .../apps/http-api/src/server.ts  -> repo root is ../../..
  // - .../apps/http-api/dist/server.js -> repo root is ../../..
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolvePath(here, "../../..");
  const repoRelative = resolvePath(repoRoot, trimmed);
  return { resolvedPath: repoRelative, source: `ASKDB_SCHEMA_PATH (${trimmed}) resolved from repo root (${repoRelative})` };
}

function modeFromHeader(v: string | undefined): AskDbModeV1 | undefined {
  if (!v) return undefined;
  return parseAskDbModeV1(v);
}

/**
 * Resolve the NL→SQL dialect for an HTTP `/ask` invocation. Same priority as
 * the CLI: `config.dialect` → `schema.provider` → `"postgres"`. Mirrors the
 * CLI's behavior so a request hits the same dialect the user authored against.
 */
function resolveHttpApiDialect(
  configDialect: BuiltInDialectId | undefined,
  schemaProvider: string | undefined,
): AskDialectInput {
  if (configDialect) return configDialect;
  if (schemaProvider && isBuiltInDialectId(schemaProvider)) return schemaProvider;
  return "postgres";
}

export function createAskDbHttpServer(options: AskDbHttpServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let cachedSchema: ReturnType<typeof loadSchema> | undefined;
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

    const rt = getAskDbRuntimeConfig();

    const logger = createAskDbLogger({
      correlationId,
      level: resolveAskDbLogLevelFromRt(rt),
      logFile: rt.logging.logFile,
      logStdout: rt.logging.logStdout,
    });

    let body: AskHttpRequest;
    try {
      body = await readJsonBody<AskHttpRequest>(req, maxBodyBytes);
    } catch (e) {
      logger.error(
        { event: AskDbLogEvent.RunError, errMessage: e instanceof Error ? e.message : String(e) },
        "invalid JSON body",
      );
      if (e instanceof RequestBodyTooLargeError) {
        writeError(res, 413, correlationId, {
          code: "payload_too_large",
          message: `request body exceeds ${e.limitBytes} bytes`,
        });
        return;
      }
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
      const mode: AskDbModeV1 = effectiveMode ?? parseAskDbModeV1(rt.modes.askdbMode);

      if ("execute" in body || getHeader(req, "x-askdb-execute") !== undefined) {
        writeError(res, 400, correlationId, {
          code: "bad_request",
          message: "Execution is not supported. This endpoint returns generated SQL only.",
        });
        return;
      }

      const mockSql = rt.dev.mockSql;
      const aiConfig = mockSql ? undefined : resolveAskDbAiConfig(rt.ai.aiEnv);
      if (!mockSql && !aiConfig) {
        writeError(res, 500, correlationId, {
          code: "generation_not_configured",
          message: `${askDbAiKeyMissingMessage("NL→SQL generation")} (or set ASKDB_MOCK_SQL).`,
        });
        return;
      }

      logger.info(
        { event: AskDbLogEvent.RunStart, mode },
        "askdb http run start",
      );

      let schema;
      try {
        // Prefer request override, otherwise use the server-default schema (cached).
        const requestOverride =
          typeof body.schemaJson === "string" && body.schemaJson.trim() !== "" ? body.schemaJson : undefined;
        if (requestOverride) {
          schema = loadSchemaFromJson(requestOverride);
        } else {
          if (!cachedSchema) {
            const envSchema = resolveSchemaJsonFromRt(rt);
            cachedSchemaSource = envSchema.source;
            if (envSchema.schemaJson) {
              cachedSchema = loadSchemaFromJson(envSchema.schemaJson);
            } else if (rt.ai.aiEnv.ASKDB_SCHEMA_PATH && rt.ai.aiEnv.ASKDB_SCHEMA_PATH.trim() !== "") {
              const { resolvedPath, source } = await resolveSchemaPathWithFallbacks(rt.ai.aiEnv.ASKDB_SCHEMA_PATH);
              cachedSchemaSource = source;
              cachedSchema = loadSchema(resolvedPath);
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
        : ((await createAskDbLanguageModelFromEnv(rt.ai.aiEnv)) as AskModel);

      const schemaProvider =
        "provider" in schema && typeof schema.provider === "string"
          ? schema.provider
          : undefined;
      const dialect = resolveHttpApiDialect(rt.nlToSql.dialect, schemaProvider);

      const out = await ask({
        question: body.question,
        schema,
        model,
        dialect,
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

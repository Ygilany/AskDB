import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNodeServer } from "node:http";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  createAiRegistry,
} from "@askdb/ai";
import { anthropicProvider } from "@askdb/ai-anthropic";
import { azureProvider } from "@askdb/ai-azure";
import { googleProvider } from "@askdb/ai-google";
import { openaiProvider } from "@askdb/ai-openai";
import {
  createAskDb,
  DialectNotSupportedError,
  ModelNotConfiguredError,
  SchemaLoadError,
  SchemaNotConfiguredError,
} from "@askdb/client";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  DEFAULT_ASKDB_MODE,
  SqlGenerationError,
  SqlValidationError,
  createAskDbLogger,
  parseAskDbModeV1,
} from "@askdb/core";
import type { AskHttpErrorResponse, AskHttpRequest, AskHttpSuccessResponse } from "./types.js";

const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider]);

export type AskDbHttpServerOptions = {
  /** Default: 3000 */
  port?: number;
  /** Default: 127.0.0.1 */
  host?: string;
  /** Server-default schema artifact path. Precedence: this option → `host.schemaPath` config → `ASKDB_SCHEMA_PATH` env. */
  schemaPath?: string;
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

function modeFromHeader(v: string | undefined): AskDbModeV1 | undefined {
  if (!v) return undefined;
  return parseAskDbModeV1(v);
}

export function createAskDbHttpServer(options: AskDbHttpServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const optionSchemaPath = options.schemaPath;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // The facade is constructed lazily on the first request so it captures the
  // runtime config that is active at that point. Config is stable for the
  // process lifetime after bootstrap; the facade's internal cache handles
  // subsequent requests.
  let askdb: ReturnType<typeof createAskDb> | undefined;

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

      // Build the facade once per server instance (lazily on first request so
      // it captures the stable runtime config).
      if (!askdb) {
        askdb = createAskDb({
          config: rt,
          registry: ai,
          // When the caller supplied a schemaPath option, it takes precedence
          // over host.schemaPath / ASKDB_SCHEMA_PATH in config.
          schema: optionSchemaPath ? { path: optionSchemaPath } : undefined,
          unknownDialect: "fallback-postgres",
        });
      }

      logger.info(
        { event: AskDbLogEvent.RunStart, mode },
        "askdb http run start",
      );

      const requestOverride =
        typeof body.schemaJson === "string" && body.schemaJson.trim() !== "" ? body.schemaJson : undefined;

      const out = await askdb.ask(body.question, {
        schema: requestOverride ? { json: requestOverride } : undefined,
        logger,
        mode: mode ?? DEFAULT_ASKDB_MODE,
        explain: Boolean(body.explain),
        omitSensitiveIdentifiersFromNlToSqlPrompt: Boolean(body.omitSensitiveFromPrompt),
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

      if (e instanceof SchemaNotConfiguredError) {
        writeError(res, 400, correlationId, {
          code: "bad_request",
          message:
            "No schema configured. Provide `schemaJson` in the request body or set ASKDB_SCHEMA_PATH / ASKDB_SCHEMA_JSON on the server.",
        });
        return;
      }

      if (e instanceof SchemaLoadError) {
        writeError(res, 400, correlationId, {
          code: "schema_parse_error",
          message: `schema parse error (${e.source}): ${e.cause instanceof Error ? e.cause.message : String(e.cause)}`,
        });
        return;
      }

      if (e instanceof ModelNotConfiguredError) {
        writeError(res, 500, correlationId, {
          code: "generation_not_configured",
          message: `${msg} (or set ASKDB_MOCK_SQL).`,
        });
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
      if (e instanceof DialectNotSupportedError) {
        writeError(res, 400, correlationId, { code: "bad_request", message: msg });
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

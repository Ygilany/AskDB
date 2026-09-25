import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNodeServer } from "node:http";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  createAiRegistry,
} from "@askdb/ai";
import {
  createAskDb,
  DialectNotSupportedError,
  ModelNotConfiguredError,
  SchemaLoadError,
  SchemaNotConfiguredError,
} from "@askdb/client";
import {
  ASKDB_MODES_V1,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  DEFAULT_ASKDB_MODE,
  SensitiveReferenceError,
  SqlGenerationError,
  SqlValidationError,
  TenantGuardrailError,
  createAskDbLogger,
  parseAskDbModeV1,
} from "@askdb/core";
import type { AskHttpErrorResponse, AskHttpRequest, AskHttpSuccessResponse } from "./types.js";

// Batteries-included surface: every built-in provider is registered, and each
// loads its @ai-sdk/* package only when first used, so env config alone
// selects the provider.
const ai = createAiRegistry();

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

/**
 * Resolve the caller-requested mode. Precedence: body `mode` → `x-askdb-mode` header.
 * Returns `undefined` when the caller did not ask for one (the server then uses config
 * `modes.askdbMode`, else {@link DEFAULT_ASKDB_MODE}). Throws on an invalid value (→ `400`).
 */
function resolveRequestMode(bodyMode: unknown, headerMode: string | undefined): AskDbModeV1 | undefined {
  if (bodyMode !== undefined && bodyMode !== null) {
    if (typeof bodyMode !== "string" || bodyMode.trim() === "") {
      throw new Error(`Invalid mode: ${JSON.stringify(bodyMode)}. Expected one of: ${ASKDB_MODES_V1.join(", ")}.`);
    }
    return parseAskDbModeV1(bodyMode);
  }
  if (headerMode !== undefined && headerMode.trim() !== "") {
    return parseAskDbModeV1(headerMode);
  }
  return undefined;
}

type MappedError = { status: number; error: AskHttpErrorResponse["error"] };

/** `instanceof` with a `name` fallback, so duplicated package copies still classify correctly. */
function isErrorOf<T extends Error>(e: unknown, ctor: abstract new (...args: never[]) => T): e is T {
  return e instanceof ctor || (e instanceof Error && e.name === ctor.name);
}

function causeMessage(e: unknown): string | undefined {
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  if (cause === undefined) return undefined;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Map an error from `askdb.ask()` to an HTTP status + client-safe body. Classification is by
 * error type only. Messages from the model provider are never returned to the client (they
 * can echo request details or credential fragments); unknown errors get a generic message.
 */
function mapAskError(e: unknown, ctx: { timedOut: boolean; timeoutMs: number }): MappedError {
  if (isErrorOf(e, SqlGenerationError)) {
    return {
      status: 502,
      error: {
        code: "sql_generation_error",
        message: ctx.timedOut
          ? `Model provider request timed out after ${ctx.timeoutMs} ms.`
          : "Model provider request failed. See server logs for this correlationId.",
      },
    };
  }
  if (isErrorOf(e, SqlValidationError)) {
    return { status: 400, error: { code: "sql_validation_error", message: e.message, rule: e.rule } };
  }
  if (isErrorOf(e, SensitiveReferenceError)) {
    return { status: 422, error: { code: "guardrail_violation", message: e.message, rule: e.rule } };
  }
  if (isErrorOf(e, TenantGuardrailError)) {
    return {
      status: 422,
      error: {
        code: "guardrail_violation",
        message: e.message,
        ...(e.warnings[0] ? { rule: e.warnings[0].rule } : {}),
      },
    };
  }
  if (isErrorOf(e, SchemaNotConfiguredError)) {
    return {
      status: 400,
      error: {
        code: "bad_request",
        message:
          "No schema configured. Set host.schemaPath / host.schemaJson in askdb.config.* (or start askdb-http with --schema-path).",
      },
    };
  }
  if (isErrorOf(e, SchemaLoadError)) {
    return {
      status: 400,
      error: {
        code: "schema_parse_error",
        message: `schema parse error (${e.source}): ${e.cause instanceof Error ? e.cause.message : String(e.cause)}`,
      },
    };
  }
  if (isErrorOf(e, ModelNotConfiguredError)) {
    return {
      status: 500,
      error: {
        code: "generation_not_configured",
        message:
          "No AI model is configured on the server. Set ai.provider / ai.providerConfig in askdb.config.* (or dev.mockSql for tests).",
      },
    };
  }
  if (isErrorOf(e, DialectNotSupportedError)) {
    return { status: 400, error: { code: "bad_request", message: e.message } };
  }
  return {
    status: 500,
    error: { code: "internal_error", message: "Internal server error. See server logs for this correlationId." },
  };
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

  const server = createNodeServer((req, res) => {
    const correlationId = getCorrelationId(req);
    handleRequest(req, res, correlationId).catch((e: unknown) => {
      // Last-resort guard: anything that escapes the handler becomes a generic 500
      // instead of an unhandled rejection that would take the process down.
      process.stderr.write(
        `askdb-http: unhandled error (correlationId=${correlationId}): ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
      );
      if (!res.headersSent) {
        writeError(res, 500, correlationId, {
          code: "internal_error",
          message: "Internal server error. See server logs for this correlationId.",
        });
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse, correlationId: string): Promise<void> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

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

    if ("execute" in body || getHeader(req, "x-askdb-execute") !== undefined) {
      writeError(res, 400, correlationId, {
        code: "bad_request",
        message: "Execution is not supported. This endpoint returns generated SQL only.",
      });
      return;
    }

    // Validate caller-controlled inputs up front so parser failures are the only
    // thing that can become a 400 here — never a substring match on a downstream error.
    let requestedMode: AskDbModeV1 | undefined;
    try {
      requestedMode = resolveRequestMode(body.mode, getHeader(req, "x-askdb-mode"));
    } catch (e) {
      writeError(res, 400, correlationId, {
        code: "bad_request",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // Config mode was validated when askdb.config.* was flattened.
    const mode: AskDbModeV1 = requestedMode ?? parseAskDbModeV1(rt.modes.askdbMode);

    let requestOverride: string | undefined;
    if (body.schemaJson !== undefined && body.schemaJson !== null) {
      if (typeof body.schemaJson !== "string") {
        writeError(res, 400, correlationId, {
          code: "bad_request",
          message: "`schemaJson` must be a string containing a bundled AskDB schema artifact.",
        });
        return;
      }
      if (body.schemaJson.trim() !== "") {
        if (!rt.httpApi.allowSchemaOverride) {
          writeError(res, 403, correlationId, {
            code: "schema_override_disabled",
            message:
              "Per-request `schemaJson` overrides are disabled on this server. Omit `schemaJson` to use the server-configured schema.",
          });
          return;
        }
        requestOverride = body.schemaJson;
      }
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

    logger.info({ event: AskDbLogEvent.RunStart, mode }, "askdb http run start");

    const timeoutMs = rt.httpApi.requestTimeoutMs;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    try {
      const out = await askdb.ask(body.question, {
        schema: requestOverride ? { json: requestOverride } : undefined,
        logger,
        mode,
        explain: Boolean(body.explain),
        // The facade treats config `modes.omitSensitiveFromPrompt` as a floor:
        // a request can tighten it but never loosen it.
        omitSensitiveIdentifiersFromNlToSqlPrompt: body.omitSensitiveFromPrompt === true,
        abortSignal,
      });

      const payload: AskHttpSuccessResponse = {
        ok: true,
        correlationId,
        sql: out.sql,
        explain: out.explain,
        usage: out.usage ?? null,
        ...(out.sensitiveGuardrail ? { sensitiveGuardrail: out.sensitiveGuardrail } : {}),
      };
      logger.info({ event: AskDbLogEvent.RunEnd, ok: true }, "askdb http run end");
      writeJson(res, 200, payload);
      return;
    } catch (e) {
      const mapped = mapAskError(e, { timedOut: abortSignal.aborted, timeoutMs });
      // Always log the full error server-side; the client only sees `mapped.error`.
      logger.error(
        {
          event: AskDbLogEvent.RunError,
          status: mapped.status,
          code: mapped.error.code,
          errName: e instanceof Error ? e.name : typeof e,
          errMessage: e instanceof Error ? e.message : String(e),
          ...(causeMessage(e) !== undefined ? { causeMessage: causeMessage(e) } : {}),
          ...(mapped.status >= 500 && e instanceof Error && e.stack ? { errStack: e.stack } : {}),
        },
        "askdb http run error",
      );
      writeError(res, mapped.status, correlationId, mapped.error);
      return;
    }
  }

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

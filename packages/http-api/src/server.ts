import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNodeServer } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
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

function getCorrelationId(req: IncomingMessage): string {
  const h = req.headers["x-correlation-id"];
  if (typeof h === "string" && h.trim() !== "") return h.trim();
  return randomUUID();
}

function badRequest(correlationId: string, message: string): AskHttpErrorResponse {
  return { ok: false, correlationId, error: { code: "bad_request", message } };
}

export function createAskDbHttpServer(options: AskDbHttpServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;

  const server = createNodeServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const correlationId = getCorrelationId(req);

    if (method === "GET" && url === "/health") {
      writeJson(res, 200, { ok: true });
      return;
    }

    if (method !== "POST" || url !== "/ask") {
      writeJson(res, 404, { ok: false, error: { code: "not_found", message: "not found" } });
      return;
    }

    const logger = createAskDbLogger({
      correlationId,
      level: resolveAskDbLogLevelFromEnv(),
      logFile: process.env.ASKDB_LOG_FILE,
      logStdout: ["1", "true", "yes"].includes((process.env.ASKDB_LOG_STDOUT ?? "").toLowerCase()),
    });

    logger.info({ event: AskDbLogEvent.RunStart }, "askdb http run start");

    let body: AskHttpRequest;
    try {
      body = await readJsonBody<AskHttpRequest>(req);
    } catch (e) {
      logger.error(
        { event: AskDbLogEvent.RunError, errMessage: e instanceof Error ? e.message : String(e) },
        "invalid JSON body",
      );
      writeJson(res, 400, badRequest(correlationId, "invalid JSON body"));
      return;
    }

    if (!body || typeof body !== "object") {
      writeJson(res, 400, badRequest(correlationId, "request body must be an object"));
      return;
    }
    if (typeof body.question !== "string" || body.question.trim() === "") {
      writeJson(res, 400, badRequest(correlationId, "`question` is required"));
      return;
    }
    if (typeof body.schemaJson !== "string" || body.schemaJson.trim() === "") {
      writeJson(res, 400, badRequest(correlationId, "`schemaJson` is required"));
      return;
    }

    let mode: AskDbModeV1;
    try {
      mode = parseAskDbModeV1(body.mode ?? process.env.ASKDB_MODE);
    } catch (e) {
      writeJson(
        res,
        400,
        badRequest(correlationId, e instanceof Error ? e.message : "invalid mode"),
      );
      return;
    }

    let schema;
    try {
      schema = loadNormalizedSchemaFromJson(body.schemaJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeJson(res, 400, { ok: false, correlationId, error: { code: "schema_parse_error", message: msg } });
      return;
    }

    const mockSql = process.env.ASKDB_MOCK_SQL;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!mockSql && !apiKey) {
      writeJson(res, 500, {
        ok: false,
        correlationId,
        error: {
          code: "execution_not_configured",
          message: "OPENAI_API_KEY is required for NL→SQL generation (or set ASKDB_MOCK_SQL).",
        },
      } satisfies AskHttpErrorResponse);
      return;
    }

    try {
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
        execute: Boolean(body.execute),
        connectionString: body.connectionString,
        logger,
        mode,
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isCore = e instanceof AskDbError;
      logger.error({ event: AskDbLogEvent.RunError, errMessage: msg }, "askdb http run error");
      const payload: AskHttpErrorResponse = {
        ok: false,
        correlationId,
        error: {
          code: isCore ? "core_error" : "internal_error",
          message: msg,
        },
      };
      writeJson(res, 500, payload);
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


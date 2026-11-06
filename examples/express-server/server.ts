/**
 * AskDB — Express server example
 *
 * Embeds AskDB in an Express app using @askdb/client.
 * Schema, model, and dialect are resolved from askdb.config.ts — no
 * per-call configuration needed.
 *
 * POST /ask  { "question": "...", "execute": false }
 *   execute: false (default) — returns { requestId, sql }
 *   execute: true            — returns { requestId, sql, rows, truncated } (requires DATABASE_URL)
 *
 * GET /health → { status: "ok" }
 *
 * Run with:
 *   npx tsx server.ts
 *
 * Environment (.env or system):
 *   OPENAI_API_KEY     — required
 *   OPENAI_MODEL       — optional, defaults to gpt-4o-mini
 *   ASKDB_SCHEMA_PATH  — path to your <name>.schema/ artifact directory
 *   DATABASE_URL       — required only when execute: true; use a read-only role
 *   PORT               — optional, defaults to 3000
 *   HOST               — optional, defaults to localhost
 */

import { randomUUID } from "node:crypto";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import express, { type Request, type Response } from "express";
import pg from "pg";

bootstrapAskDbEnv({ cwd: process.cwd() });

const app = express();
app.use(express.json());

const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  // Every built-in provider is registered; ai.provider in askdb.config.ts picks
  // OpenAI, whose SDK (@ai-sdk/openai) this example installs.
  // schema resolved from host.schemaPath in askdb.config.ts
});

// Connect as a read-only, least-privilege role, with a statement timeout.
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 5000 })
  : null;

const ROW_CAP = 1000;

// Runs one generated statement in a read-only transaction and reads at most
// ROW_CAP rows, as in the docs' "Run safely in production" guide (Row limits).
async function runCapped(db: pg.Pool, sql: string, params: unknown[] = []) {
  const client = await db.connect();
  const onError = () => undefined;
  client.on("error", onError);
  try {
    await client.query("BEGIN READ ONLY");
    // A variable, not an inline object: @types/pg doesn't declare queryMode.
    const declare = { text: `DECLARE askdb_rows NO SCROLL CURSOR FOR ${sql}`, values: params, queryMode: "extended" };
    await client.query(declare);
    const { rows } = await client.query(`FETCH ${ROW_CAP + 1} FROM askdb_rows`);
    return { rows: rows.slice(0, ROW_CAP), truncated: rows.length > ROW_CAP };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.off("error", onError);
    client.release();
  }
}

app.post("/ask", async (req: Request, res: Response) => {
  const requestId = randomUUID();
  const { question, execute } = (req.body ?? {}) as { question?: unknown; execute?: unknown };

  if (typeof question !== "string" || question.trim() === "") {
    res.status(400).json({ requestId, error: "question is required and must be a non-empty string" });
    return;
  }

  if (execute !== undefined && typeof execute !== "boolean") {
    res.status(400).json({ requestId, error: "execute must be a boolean when provided" });
    return;
  }

  if (execute && !pool) {
    res.status(500).json({ requestId, error: "DATABASE_URL is not configured" });
    return;
  }

  // Errors can carry provider or schema details: log them, and send the caller a generic message.
  let result;
  try {
    result = await askdb.ask(question.trim());
  } catch (err) {
    console.error({ requestId, question, err });
    res.status(500).json({ requestId, error: "Could not generate SQL for this question. See the server log for this requestId." });
    return;
  }

  // `sql` runs with `tenantParams` (none here: this server passes no tenant scope).
  const { sql, tenantParams } = result;
  console.log({ requestId, question, sql, execute: execute === true });

  if (!execute) {
    res.json({ requestId, sql });
    return;
  }

  try {
    const { rows, truncated } = await runCapped(pool!, sql, tenantParams ?? []);
    res.json({ requestId, sql, rows, truncated });
  } catch (err) {
    console.error({ requestId, sql, err });
    res.status(500).json({ requestId, sql, error: "The query failed. See the server log for this requestId." });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? "localhost";

app.listen(port, host, () => {
  console.log(`AskDB Express server listening on http://${host}:${port}`);
  console.log(`POST /ask  { "question": "...", "execute": false }  →  { "requestId": "...", "sql": "..." }`);
});

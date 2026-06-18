/**
 * AskDB — Express server example
 *
 * Embeds AskDB in an Express app using @askdb/client.
 * Schema, model, and dialect are resolved from askdb.config.ts — no
 * per-call configuration needed.
 *
 * POST /ask  { "question": "...", "execute": false }
 *   execute: false (default) — returns { sql }
 *   execute: true            — returns { sql, rows, rowCount } (requires DATABASE_URL)
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
 *   DATABASE_URL       — required only when execute: true
 *   PORT               — optional, defaults to 3000
 *   HOST               — optional, defaults to localhost
 */

import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import express, { Request, Response } from "express";
import pg from "pg";

bootstrapAskDbEnv({ cwd: process.cwd() });

const app = express();
app.use(express.json());

const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  registry: createAiRegistry([openaiProvider]),
  // schema resolved from host.schemaPath in askdb.config.ts
});

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

app.post("/ask", async (req: Request, res: Response) => {
  const { question, execute } = req.body as { question?: string; execute?: boolean };

  if (!question || typeof question !== "string" || question.trim() === "") {
    res.status(400).json({ error: "question is required and must be a non-empty string" });
    return;
  }

  if (execute !== undefined && typeof execute !== "boolean") {
    res.status(400).json({ error: "execute must be a boolean when provided" });
    return;
  }

  const shouldExecute = execute === true;

  if (shouldExecute && !pool) {
    res.status(500).json({ error: "DATABASE_URL is not configured" });
    return;
  }

  try {
    const { sql } = await askdb.ask(question.trim());

    console.log({ question, sql, execute: shouldExecute });

    if (!shouldExecute) {
      res.json({ sql });
      return;
    }

    try {
      const result = await pool!.query(sql);
      res.json({ sql, rows: result.rows, rowCount: result.rowCount });
    } catch (execErr) {
      const message = execErr instanceof Error ? execErr.message : String(execErr);
      console.error("SQL execution error:", message);
      res.status(500).json({ sql, error: message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("AskDB error:", message);
    res.status(500).json({ error: message });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? "localhost";

app.listen(port, host, () => {
  console.log(`AskDB Express server listening on http://${host}:${port}`);
  console.log(`POST /ask  { "question": "...", "execute": false }  →  { "sql": "..." }`);
});

import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { ask, loadSchema, suggestEnrichment, type AskGenerateDeps } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import {
  buildDefaultTableBody,
  buildFrontmatter,
  buildSuggestionContext,
  buildSuggestionTarget,
  buildTableDraft,
  loadWorkspace,
  replaceH2Section,
  replaceTableDescription,
  saveTable,
  type SuggestSource,
  type TableDraft,
  type Workspace,
} from "@askdb/tui";
import { APP_JS, INDEX_HTML, STYLES_CSS } from "./static.js";

export type StudioOptions = {
  schema: string;
  host?: string;
  port?: number;
};

export type StudioServer = ReturnType<typeof createServer>;

type StudioState = {
  schemaDir: string;
  workspace: Workspace;
};

export function createStudioServer(options: StudioOptions): StudioServer {
  const schemaDir = resolve(options.schema);
  if (!existsSync(schemaDir)) {
    throw new Error(`schema directory not found: ${schemaDir}`);
  }

  const state: StudioState = {
    schemaDir,
    workspace: loadWorkspace(schemaDir),
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/") {
        return writeText(res, 200, "text/html; charset=utf-8", INDEX_HTML);
      }
      if (req.method === "GET" && url.pathname === "/assets/styles.css") {
        return writeText(res, 200, "text/css; charset=utf-8", STYLES_CSS);
      }
      if (req.method === "GET" && url.pathname === "/assets/app.js") {
        return writeText(res, 200, "text/javascript; charset=utf-8", APP_JS);
      }
      if (req.method === "GET" && url.pathname === "/api/workspace") {
        return writeJson(res, 200, serializeWorkspace(state.workspace));
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/tables/")) {
        const tableId = decodeURIComponent(url.pathname.slice("/api/tables/".length));
        const body = await readJson(req);
        const draft = parseTableDraftBody(body);
        saveDraft(state, tableId, draft);
        return writeJson(res, 200, serializeWorkspace(state.workspace));
      }
      if (req.method === "POST" && url.pathname === "/api/suggest") {
        const body = await readJson(req);
        const source = parseSuggestSource(body);
        const candidates = await suggestForSource(state.workspace, source);
        return writeJson(res, 200, { candidates });
      }
      if (req.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJson(req);
        const question = parseQuestion(body);
        const result = await askSampleQuestion(state.schemaDir, question);
        return writeJson(res, 200, result);
      }
      writeJson(res, 404, { error: { message: "Not found" } });
    } catch (error) {
      const status = error instanceof StudioHttpError ? error.status : 500;
      writeJson(res, status, {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}

export function serializeWorkspace(workspace: Workspace): unknown {
  return {
    schemaDir: workspace.schemaDir,
    schemaId: workspace.physical.schemaId,
    warnings: workspace.warnings,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model:
      process.env.ASKDB_STUDIO_MODEL ??
      process.env.ASKDB_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-4o-mini",
    tables: workspace.tables.map((table) => {
      const draft = buildTableDraft(table.physical, table.parsed);
      return {
        physical: table.physical,
        filename: table.filename,
        hasDescribableFile: Boolean(table.parsed),
        draft,
        missingColumnIds: workspace.warnings
          .filter(
            (
              warning,
            ): warning is Extract<Workspace["warnings"][number], { kind: "missing_column_md" }> =>
              warning.kind === "missing_column_md" && warning.tableId === table.physical.id,
          )
          .map((warning) => warning.columnId),
      };
    }),
    concepts: workspace.concepts?.frontmatter.concepts ?? [],
  };
}

function saveDraft(state: StudioState, tableId: string, draft: TableDraft): void {
  const table = state.workspace.tables.find((candidate) => candidate.physical.id === tableId);
  if (!table) throw new StudioHttpError(404, `No such table: ${tableId}`);

  const frontmatter = buildFrontmatter(
    table.physical,
    state.workspace.physical.schemaId,
    draft,
  );
  let body = table.parsed
    ? replaceTableDescription(table.parsed.body, draft.description)
    : buildDefaultTableBody(table.physical.name, draft.description);
  if (draft.commonQueryLanguage !== undefined) {
    body = replaceH2Section(body, "Common query language", draft.commonQueryLanguage);
  }
  if (draft.exampleQuestions !== undefined) {
    body = replaceH2Section(body, "Example questions", draft.exampleQuestions);
  }

  saveTable(state.workspace, tableId, frontmatter, body);
  state.workspace = loadWorkspace(state.schemaDir);
}

async function suggestForSource(workspace: Workspace, source: SuggestSource): Promise<Array<{ text: string }>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new StudioHttpError(400, "OPENAI_API_KEY is required for AI enrichment suggestions.");
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  const modelId =
    process.env.ASKDB_STUDIO_MODEL ??
    process.env.ASKDB_TUI_MODEL ??
    process.env.ASKDB_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-4o-mini";
  const candidates = await suggestEnrichment(
    buildSuggestionTarget(workspace, source),
    buildSuggestionContext(workspace, source.tableId),
    openai(modelId),
  );
  return candidates.map((candidate) => ({ text: candidate.text }));
}

async function askSampleQuestion(schemaDir: string, question: string): Promise<unknown> {
  const mockSql = process.env.ASKDB_MOCK_SQL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!mockSql && !apiKey) {
    throw new StudioHttpError(
      400,
      "OPENAI_API_KEY is required for sample NL-to-SQL generation. Set ASKDB_MOCK_SQL to bypass the live model.",
    );
  }

  const schema = loadSchema(schemaDir);
  type AskModel = Parameters<typeof ask>[0]["model"];
  const model: AskModel = mockSql
    ? (undefined as unknown as AskModel)
    : (() => {
        const openai = createOpenAI({
          apiKey: apiKey!,
          baseURL: process.env.OPENAI_BASE_URL,
        });
        const modelId =
          process.env.ASKDB_STUDIO_MODEL ??
          process.env.ASKDB_MODEL ??
          process.env.OPENAI_MODEL ??
          "gpt-4o-mini";
        return openai(modelId);
      })();

  const result = await ask({
    question,
    schema,
    model,
    dialect: postgresDialect,
    explain: true,
    deps:
      mockSql !== undefined
        ? {
            generateText: (async () => ({ text: mockSql } as any)) as NonNullable<
              AskGenerateDeps["generateText"]
            >,
          }
        : undefined,
  });

  return {
    sql: result.sql,
    explain: result.explain ?? null,
    warnings: schema.warnings,
  };
}

function parseTableDraftBody(body: unknown): TableDraft {
  if (!isRecord(body) || !isRecord(body.draft)) {
    throw new StudioHttpError(400, "`draft` is required.");
  }
  const draft = body.draft;
  if (typeof draft.description !== "string") {
    throw new StudioHttpError(400, "`draft.description` is required.");
  }
  if (!isRecord(draft.columns)) {
    throw new StudioHttpError(400, "`draft.columns` is required.");
  }
  return draft as TableDraft;
}

function parseSuggestSource(body: unknown): SuggestSource {
  if (!isRecord(body) || !isRecord(body.source)) {
    throw new StudioHttpError(400, "`source` is required.");
  }
  const source = body.source;
  if (source.scope === "table") {
    if (typeof source.tableId !== "string" || typeof source.field !== "string") {
      throw new StudioHttpError(400, "`source.tableId` and `source.field` are required.");
    }
    if (!["description", "aliases", "primaryEntity", "commonQueryLanguage"].includes(source.field)) {
      throw new StudioHttpError(400, "Unsupported table suggestion field.");
    }
    return source as SuggestSource;
  }
  if (source.scope === "column") {
    if (
      typeof source.tableId !== "string" ||
      typeof source.columnId !== "string" ||
      typeof source.field !== "string"
    ) {
      throw new StudioHttpError(
        400,
        "`source.tableId`, `source.columnId`, and `source.field` are required.",
      );
    }
    if (!["description", "aliases"].includes(source.field)) {
      throw new StudioHttpError(400, "Unsupported column suggestion field.");
    }
    return source as SuggestSource;
  }
  throw new StudioHttpError(400, "Unsupported suggestion source.");
}

function parseQuestion(body: unknown): string {
  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  return body.question.trim();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioHttpError(400, "Request body must be valid JSON.");
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  writeText(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function writeText(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class StudioHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StudioHttpError";
  }
}

/**
 * `pnpm lab <command>`: the maintainer's entry point to the consumer lab.
 *
 *   pnpm lab ask --db <dialect> "<catalog question>" [--via raw|client]
 *   pnpm lab ask --db <dialect> --sql "SELECT …" ["question"]
 *
 * Asks AskDB the question with the lab's replay model standing in for OpenAI, through
 * one of the two documented model paths:
 *
 *   --via raw     (default) a Vercel AI SDK `LanguageModel` from `createOpenAI({ baseURL })`,
 *                 passed to `ask()` from `@askdb/core`;
 *   --via client  `createAskDb` from `@askdb/client` with `@askdb/ai-openai`, configured by
 *                 `askdb.config.ts` (`providerConfig.openai.baseUrl`).
 *
 * With `--sql`, the SQL goes through `ask()` as if a model had written it (the documented
 * `deps.generateText` seam) and no model is called.
 *
 * Prints the SQL and the validation outcome, then executes accepted SQL on the fixture
 * as the read-only role and prints the rows. Rejected SQL is never executed.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createOpenAI } from "@ai-sdk/openai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { AskDbError, ask, loadSchema, type AskGenerateDeps } from "@askdb/core";
import { ensureArtifact, requireInstallTarget } from "./artifacts.js";
import { LAB_ROOT } from "./paths.js";
import { SUPPORTED_DIALECTS, isSupportedDialect, type SupportedDialect } from "./dialects.js";
import { executeReadOnly, type ExecuteResult } from "./host/execute.js";
import { startReplayServer, type ReplayServer } from "./model/replay-server.js";

const VIAS = ["raw", "client"] as const;
type Via = (typeof VIAS)[number];

const USAGE = [
  `usage: pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> "<catalog question>" [--via ${VIAS.join("|")}]`,
  `       pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> --sql "<sql>" ["question"]`,
].join("\n");

/** The model id sent to the replay server; the same as the config's `providerConfig.openai.model`. */
const MODEL_ID = "gpt-4o-mini";
/** The replay server ignores it; the OpenAI client requires one. */
const API_KEY = "lab-replay-no-key";

type AskResult = Awaited<ReturnType<typeof ask>>;

/**
 * The documented `deps.generateText` seam: a "model" that always answers with this SQL,
 * fenced the way a model reply is.
 */
function fixedSqlReply(sql: string): NonNullable<AskGenerateDeps["generateText"]> {
  // Only `text` is read from a generateText result on this path.
  return (async () => ({ text: `\`\`\`sql\n${sql}\n\`\`\`` })) as unknown as NonNullable<AskGenerateDeps["generateText"]>;
}

/** Path (a): a raw AI SDK `LanguageModel` pointed at the replay server, passed to `ask()`. */
async function askRaw(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string): Promise<AskResult> {
  const openai = createOpenAI({ baseURL, apiKey: API_KEY });
  return ask({ question, schema: loadSchema(schemaDir), model: openai(MODEL_ID), dialect });
}

/**
 * Path (b): `createAskDb` with the OpenAI adapter. The model comes from `askdb.config.ts`,
 * whose `baseUrl` reads LAB_REPLAY_BASE_URL. The dialect is passed explicitly: MariaDB is
 * introspected with the MySQL engine, so its artifact records `mysql`.
 */
async function askClient(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string): Promise<AskResult> {
  process.env.LAB_REPLAY_BASE_URL = baseURL;
  bootstrapAskDbEnv({ cwd: LAB_ROOT });
  const askdb = createAskDb({
    config: getAskDbRuntimeConfig(),
    providers: [openaiProvider],
    schema: { path: schemaDir },
    dialect,
    onResolve: (info) => console.log(`resolved:   ${JSON.stringify(info)}`),
  });
  return askdb.ask(question);
}

/** Continuation lines line up under the first, after the 12-column labels. */
function indent(text: string): string {
  return text.replace(/\n/g, `\n${" ".repeat(12)}`);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function formatRows(result: ExecuteResult): string {
  const cells = [result.columns, ...result.rows.map((row) => row.map(formatValue))];
  const widths = result.columns.map((_, i) => Math.max(...cells.map((r) => (r[i] as string).length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const header = line(cells[0] as string[]);
  const n = result.rows.length;
  const count = result.truncated ? `more than ${n} rows (showing ${n})` : `${n} ${n === 1 ? "row" : "rows"}`;
  return [header, "-".repeat(header.length), ...cells.slice(1).map((r) => line(r as string[])), "", count].join("\n");
}

async function askCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { db: { type: "string" }, sql: { type: "string" }, via: { type: "string", default: "raw" } },
    allowPositionals: true,
  });
  const dialect = values.db;
  const via = values.via as Via;
  const question = positionals.join(" ");
  if (!dialect || !isSupportedDialect(dialect) || !(VIAS as readonly string[]).includes(via) || (!values.sql && !question)) {
    console.error(USAGE);
    return 2;
  }

  console.log(`target:     ${requireInstallTarget().label}`);
  console.log(`dialect:    ${dialect}`);
  const schemaDir = ensureArtifact(dialect);

  let replay: ReplayServer | undefined;
  // What the model was sent, as a digest: equal digests mean the two paths built the same prompt.
  const showPrompt = () => {
    const prompt = replay?.requests().at(-1)?.prompt;
    if (prompt) console.log(`prompt:     ${prompt.length} chars, sha256 ${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}`);
  };
  let result: AskResult;
  try {
    if (values.sql) {
      console.log("model:      none (--sql, through deps.generateText)");
      // `model` is required; with `deps.generateText` supplied it is never called.
      const model = {} as Parameters<typeof ask>[0]["model"];
      const deps = { generateText: fixedSqlReply(values.sql) };
      result = await ask({ question: question || "Run the SQL supplied with --sql.", schema: loadSchema(schemaDir), model, dialect, deps });
    } else {
      replay = await startReplayServer();
      const baseURL = replay.baseURL(dialect);
      console.log(`model:      replay at ${baseURL}, via ${via === "raw" ? "createOpenAI() → ask()" : "createAskDb() + @askdb/ai-openai"}`);
      result = await (via === "raw" ? askRaw : askClient)(dialect, question, schemaDir, baseURL);
      showPrompt();
    }
  } catch (error) {
    showPrompt();
    // A request the replay server refused: say what's missing, not AskDB's wrapping of it.
    const refused = replay?.requests().find((r) => r.error);
    if (refused) {
      console.error(refused.error);
      return 1;
    }
    // Only AskDB's documented errors (SqlValidationError, SensitiveReferenceError, tenant
    // errors, …, all AskDbError subclasses) are outcomes to report; anything else is a bug.
    if (!(error instanceof AskDbError)) throw error;
    const rule = "rule" in error ? ` ${String(error.rule)}` : "";
    const reply = values.sql ?? replay?.requests().at(-1)?.reply;
    if (reply) console.log(`${values.sql ? "sql:  " : "reply:"}      ${indent(reply)}`);
    console.log(`validation: rejected — ${error.name}${rule}`);
    console.log(`            ${error.message}`);
    return 1;
  } finally {
    await replay?.close();
  }

  console.log(`sql:        ${indent(result.sql)}`);
  if (result.unboundSql) console.log(`unbound:    ${result.unboundSql}  params: ${JSON.stringify(result.params ?? [])}`);
  console.log("validation: ok");
  if (result.sensitiveGuardrail && !result.sensitiveGuardrail.passed) {
    console.log(`sensitive:  ${JSON.stringify(result.sensitiveGuardrail.references)}`);
  }
  console.log("");
  console.log(formatRows(await executeReadOnly(dialect, result.sql)));
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "ask") return askCommand(rest);
  console.error(USAGE);
  return 2;
}

process.exitCode = await main();

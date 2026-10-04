/**
 * `pnpm lab <command>`: the maintainer's entry point to the consumer lab.
 *
 *   pnpm lab ask --db <dialect> "<catalog question>" [--via raw|client]
 *   pnpm lab ask --db <dialect> --sql "SELECT …" ["question"]
 *   pnpm lab ui [--port <port>] [--timeout <ms>]
 *
 * `lab ask` asks AskDB the question on one engine, with the lab's replay model standing in
 * for OpenAI (or `--sql` standing in for the model), and prints the SQL, the validation
 * outcome and, for accepted SQL, the rows the read-only role reads (`src/ask-run.ts`).
 *
 * `lab ui` serves a page on 127.0.0.1 that runs one input on every engine at once, through
 * the same code path, side by side (`src/ui/server.ts`).
 */
import { parseArgs } from "node:util";
import { askAndRun, VIAS, type Via } from "./ask-run.js";
import { requireInstallTarget } from "./artifacts.js";
import { SUPPORTED_DIALECTS, isSupportedDialect } from "./dialects.js";
import { MODEL_MODE, startLabUi } from "./ui/server.js";

const USAGE = [
  `usage: pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> "<catalog question>" [--via ${VIAS.join("|")}]`,
  `       pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> --sql "<sql>" ["question"]`,
  "       pnpm lab ui [--port <port>] [--timeout <ms>]",
].join("\n");

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

  const run = await askAndRun(dialect, { question, sql: values.sql, via }, {
    onLine: (line) => (line.stream === "stdout" ? console.log : console.error)(line.text),
  });
  if (run.status === "failed") throw run.error;
  return run.exitCode!;
}

/** Node can't hold a longer timer: it fires one after 1 ms instead. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** An option's text as a whole number from `min` to `max`, or undefined for anything else, blank included. */
function wholeNumber(text: string, min: number, max: number): number | undefined {
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  return n >= min && n <= max ? n : undefined;
}

async function uiCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string", default: "0" }, timeout: { type: "string", default: "60000" } } });
  const port = wholeNumber(values.port, 0, 65535);
  const engineTimeoutMs = wholeNumber(values.timeout, 1, MAX_TIMEOUT_MS);
  if (port === undefined || engineTimeoutMs === undefined) {
    console.error(USAGE);
    return 2;
  }
  const target = requireInstallTarget();
  const ui = await startLabUi({ port, engineTimeoutMs });
  console.log(`lab ui:     ${ui.url}`);
  console.log(`target:     ${target.label}`);
  console.log(`model:      ${MODEL_MODE}`);
  console.log("Ctrl-C stops it.");
  await new Promise<void>((resolve) => {
    const stop = () => void ui.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  // A timed-out engine's driver socket can't be cancelled and would keep the process alive.
  process.exit(0);
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "ask") return askCommand(rest);
  if (command === "ui") return uiCommand(rest);
  console.error(USAGE);
  return 2;
}

process.exitCode = await main();

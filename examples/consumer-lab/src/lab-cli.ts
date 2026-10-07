/**
 * `pnpm lab <command>`: the maintainer's entry point to the consumer lab.
 *
 *   pnpm lab ask --db <dialect> "<question>" [--via raw|client] [--model replay|live]
 *   pnpm lab ask --db <dialect> --sql "SELECT …" ["question"]
 *   pnpm lab ui [--port <port>] [--timeout <ms>]
 *
 * `lab ask` asks AskDB the question on one engine, with the lab's replay model standing in
 * for OpenAI (or `--sql` standing in for the model), and prints the SQL, the validation
 * outcome and, for accepted SQL, the rows the read-only role reads (`src/ask-run.ts`).
 * `--model live` asks the live OpenAI model instead (#448), with the key from
 * `liveSettings` (`src/model/live.ts`): it refuses in CI and without a key, before anything
 * runs, and never falls back to the replay model. Only the flag switches it:
 * `LAB_LIVE_MODEL=1`, which turns on the live suite, doesn't, so no exported variable spends.
 *
 * `lab ui` serves a page on 127.0.0.1 that runs one input on the engines you pick at once,
 * through the same code path, side by side (`src/ui/server.ts`).
 */
import { parseArgs, type ParseArgsConfig } from "node:util";
import { askAndRun, VIAS, type Via } from "./ask-run.js";
import { requireInstallTarget } from "./artifacts.js";
import { SUPPORTED_DIALECTS, isSupportedDialect } from "./dialects.js";
import { LiveModelError, liveSettings, type LiveSettings } from "./model/live.js";
import { startLabUi } from "./ui/server.js";

const MODELS = ["replay", "live"] as const;

const USAGE = [
  `usage: pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> "<question>" [--via ${VIAS.join("|")}] [--model ${MODELS.join("|")}]`,
  `       pnpm lab ask --db <${SUPPORTED_DIALECTS.join("|")}> --sql "<sql>" ["question"]`,
  "       pnpm lab ui [--port <port>] [--timeout <ms>]",
].join("\n");

/** `parseArgs`, or undefined after printing why and the usage: an unknown option, a missing value, an extra argument. */
function parse<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> | undefined {
  try {
    return parseArgs(config);
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return undefined;
  }
}

async function askCommand(argv: string[]): Promise<number> {
  const parsed = parse({
    args: argv,
    options: { db: { type: "string" }, sql: { type: "string" }, via: { type: "string", default: "raw" }, model: { type: "string", default: "replay" } },
    allowPositionals: true,
  });
  if (!parsed) return 2;
  const { values, positionals } = parsed;
  const dialect = values.db;
  const via = values.via as Via;
  const question = positionals.join(" ");
  // `--sql` that was given is what runs: blank SQL is refused, never replaced by the question.
  const sqlOk = values.sql === undefined ? Boolean(question) : values.sql.trim() !== "";
  // `--sql` calls no model, so it can't be asked of the live one.
  const modelOk = (MODELS as readonly string[]).includes(values.model) && !(values.model === "live" && values.sql !== undefined);
  if (!dialect || !isSupportedDialect(dialect) || !(VIAS as readonly string[]).includes(via) || !sqlOk || !modelOk) {
    console.error(USAGE);
    return 2;
  }
  let live: LiveSettings | undefined;
  if (values.model === "live") {
    try {
      live = liveSettings("live mode");
    } catch (error) {
      if (!(error instanceof LiveModelError)) throw error;
      console.error(`lab ask: ${error.message}`);
      return 2;
    }
  }

  const run = await askAndRun(dialect, { question, sql: values.sql, via, live }, {
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
  const parsed = parse({ args: argv, options: { port: { type: "string", default: "0" }, timeout: { type: "string", default: "60000" } } });
  if (!parsed) return 2;
  const { values } = parsed;
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
  console.log(`live model: ${ui.live.available ? ui.live.modelId : `unavailable: ${ui.live.reason}`}`);
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

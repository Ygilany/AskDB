/**
 * `pnpm lab:record [--db <dialect>]… [--only <catalog question id>]…`: records the catalog's
 * replies from a live OpenAI model (`src/record.ts` says how). Needs `OPENAI_API_KEY`, in the
 * shell or in a `.env.live` in the lab or at the repo root; refuses to run in CI.
 *
 * Exit codes (`writeRecordReport` in `src/record.ts`): 0 when every question was asked (misses
 * included: they're model quality); 1 when the run stopped (the provider refused a request, the
 * fixture or a model call failed) or a reply broke a guarantee; 2 for a usage error, a missing
 * key, a CI run, or an id that can't be recorded. Every run that asked
 * anything rewrites `.lab/record-misses.json` with its misses and violations, an aborted one too.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { requireInstallTarget } from "./artifacts.js";
import { SUPPORTED_DIALECTS, isSupportedDialect, type SupportedDialect } from "./dialects.js";
import { LiveModelError, liveSettings, type LiveSettings } from "./model/live.js";
import { LAB_STATE } from "./paths.js";
import { RecordAbort, RecordRefusal, portableTarget, record, selectQuestions, writeRecordReport, type RecordOutcome } from "./record.js";

const MISSES_FILE = join(LAB_STATE, "record-misses.json");

const USAGE = `usage: pnpm lab:record [--db <${SUPPORTED_DIALECTS.join("|")}>]… [--only <catalog question id>]…`;

async function main(argv: string[]): Promise<number> {
  let values: { db?: string[]; only?: string[] };
  try {
    ({ values } = parseArgs({ args: argv, options: { db: { type: "string", multiple: true }, only: { type: "string", multiple: true } } }));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const bad = (values.db ?? []).filter((d) => !isSupportedDialect(d));
  if (bad.length) {
    console.error(`lab:record: unknown dialect ${bad.join(", ")}\n${USAGE}`);
    return 2;
  }
  let settings: LiveSettings;
  let outcome: RecordOutcome;
  let stopped: string | undefined;
  try {
    // An id that can't be recorded is refused before the key is looked for.
    selectQuestions(values.only);
    settings = liveSettings("lab:record");
    const installed = requireInstallTarget();
    const target = portableTarget(installed);
    console.log(`target:     ${installed.label}`);
    console.log(`model:      ${settings.modelId} (OpenAI, through the lab's recording proxy)`);
    try {
      outcome = await record({ settings, target, dialects: values.db as SupportedDialect[] | undefined, only: values.only, log: (line) => console.log(line) });
    } catch (error) {
      if (!(error instanceof RecordAbort)) throw error;
      outcome = error.outcome;
      stopped = error.message;
    }
  } catch (error) {
    if (error instanceof LiveModelError || error instanceof RecordRefusal) {
      console.error(`lab:record: ${error.message}`);
      return 2;
    }
    throw error;
  }
  const report = writeRecordReport(outcome, settings.modelId, MISSES_FILE, stopped);
  console.log(report.summary.join("\n"));
  if (stopped) console.error(`lab:record: stopped. ${stopped}`);
  return report.exitCode;
}

process.exitCode = await main(process.argv.slice(2));

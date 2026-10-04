/**
 * `pnpm lab:record [--db <dialect>]… [--only <catalog question id>]…`: records the catalog's
 * replies from a live OpenAI model (`src/record.ts` says how). Needs `OPENAI_API_KEY`, in the
 * shell or in a `.env.live` in the lab or at the repo root; refuses to run in CI.
 *
 * Exit codes: 0 when every question was asked (misses included: they're model quality); 1 when a
 * request failed and stopped the run (a bad key, a quota), or a reply broke a guarantee; 2 for a
 * usage error, a missing key, a CI run, or an id that can't be recorded. Every run that asked
 * anything rewrites `.lab/record-misses.json` with its misses and violations, an aborted one too.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { requireInstallTarget } from "./artifacts.js";
import { SUPPORTED_DIALECTS, isSupportedDialect, type SupportedDialect } from "./dialects.js";
import { displayPath } from "./model/catalog.js";
import { LiveModelError, liveSettings, type LiveSettings } from "./model/live.js";
import { LAB_STATE } from "./paths.js";
import { RecordAbort, portableTarget, record, selectQuestions, type RecordOutcome } from "./record.js";

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
    if (error instanceof LiveModelError) {
      console.error(`lab:record: ${error.message}`);
      return 2;
    }
    throw error;
  }
  mkdirSync(LAB_STATE, { recursive: true });
  writeFileSync(MISSES_FILE, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: settings.modelId, misses: outcome.misses, violations: outcome.violations }, null, 2)}\n`);
  console.log(
    [
      "",
      `${outcome.written.length} recorded, ${outcome.unchanged.length} unchanged, ${outcome.misses.length} missed (not written; listed in ${displayPath(MISSES_FILE)}).`,
      ...(outcome.violations.length ? [`${outcome.violations.length} guarantee violation(s), not written: a product failure to file (listed in ${displayPath(MISSES_FILE)}).`] : []),
      ...(outcome.written.length ? ["Review: git diff examples/consumer-lab/cassettes/  (stage what you accept, git restore what you reject)"] : []),
    ].join("\n"),
  );
  if (stopped) {
    console.error(`lab:record: stopped. ${stopped}`);
    return 1;
  }
  return outcome.violations.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));

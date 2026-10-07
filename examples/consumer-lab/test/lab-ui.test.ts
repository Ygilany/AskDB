/**
 * `pnpm lab ui`: one input run on every engine at once, one column per engine, driven over
 * HTTP the way its page drives it (`POST /api/run`, read back as NDJSON).
 *
 * The authoring-gate answers are per scenario, above each group of tests. For all of them:
 * No production seam: the tests start the real `pnpm lab ui` command (through `tsx`, as
 * `pnpm lab` does) and the real `pnpm lab ask`, and send the requests the page sends. Every
 * `lab ui` here starts without a key (`support/lab-ui.ts`), so none can ask the live model,
 * except the live scenarios', which get a fake key and the stand-in for OpenAI
 * (`support/stub-openai-fetch.mjs`, preloaded with `NODE_OPTIONS`), which replaces `fetch` for
 * `api.openai.com` only and accepts only that key: none can reach the network or spend. Engines
 * are made to fail only from outside: `ASKDB_FIXTURE_<ENGINE>_PORT`, the fixture's own
 * documented port override, points one engine at a closed port or at a socket that never
 * answers. `--timeout` is the command's own option.
 *
 * Scenarios that run every engine have a cell per engine. The page and local-only scenarios
 * don't depend on an engine and run once, as `[postgres]`, as the Studio suite's protection
 * scenarios do.
 *
 * Needs the `cli-introspect-engine` capability (every column builds a schema artifact), the
 * fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureArtifact, requireInstallTarget } from "../src/artifacts.js";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { findQuestion } from "../src/model/catalog.js";
import { freePort } from "../src/server-process.js";
import { studioRequest } from "../src/studio.js";
import type { UiInput } from "../src/ui/server.js";
import { column, startLabUiProcess, uiRun, type LabUiProcess, type UiRun } from "./support/lab-ui.js";
import { STUB_KEY, stubOpenAiEnv } from "./support/stub-openai.js";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const AGENCY_NAMES = findQuestion("agency-names")!.text;
/** Ordered decimals: the drivers return them as different JavaScript types, which normalization reconciles. */
const TOP_PAID = findQuestion("top-paid-agencies")!.text;
const NO_REPLY = "Which agency has the most volunteers?";
/** The parameterized question, which the grader checks for more than its rows. */
const PROGRAMS_SINCE = findQuestion("programs-started-since")!.text;
const UNPAID = findQuestion("unpaid-orders")!.text;
const SATO = findQuestion("client-named-sato")!.text;
const DIALECTS = SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]);

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `pnpm lab <args>`. One still running after `killAfterMs` is killed, with its children, and has status null. */
function lab(args: string[], killAfterMs = 120_000): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--silent", "lab", ...args], { cwd: LAB, detached: true });
    const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), killAfterMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

const labAsk = (...args: string[]) => lab(["ask", ...args]);

/** Each run starts its own replay server on a free port: mask the port, so nothing else may differ. */
const maskPorts = (run: CliRun): CliRun => {
  const strip = (text: string) => text.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  return { status: run.status, stdout: strip(run.stdout), stderr: strip(run.stderr) };
};

/** What a column says `lab ask` prints, as `lab ask` would print it to each stream. */
function printed(run: UiRun, dialect: SupportedDialect): CliRun {
  const event = column(run, dialect);
  const stream = (s: "stdout" | "stderr") => event.lines.filter((l) => l.stream === s).map((l) => `${l.text}\n`).join("");
  return maskPorts({ status: event.exitCode ?? null, stdout: stream("stdout"), stderr: stream("stderr") });
}

let ui: LabUiProcess;
const runs = new Map<string, Promise<UiRun>>();
/** One `POST /api/run` per input, shared by the scenarios that read it. */
function runOnce(input: UiInput): Promise<UiRun> {
  const key = JSON.stringify(input);
  if (!runs.has(key)) runs.set(key, uiRun(ui, input));
  return runs.get(key)!;
}

/** Postgres points at a socket that accepts and never answers; MySQL at a port nothing listens on. */
const TIMEOUT_MS = 8_000;
let failingUi: LabUiProcess | undefined;
let silentServer: Server | undefined;
const heldSockets: Socket[] = [];
let failingRun: Promise<UiRun> | undefined;

/**
 * The input run with two engines failing. The schema artifacts are built first, from the
 * real ports, so the failures come from executing the SQL, not from introspection.
 */
function runWithEnginesDown(): Promise<UiRun> {
  failingRun ??= (async () => {
    for (const dialect of SUPPORTED_DIALECTS) ensureArtifact(dialect);
    silentServer = createServer((socket) => void heldSockets.push(socket));
    await new Promise<void>((resolve) => silentServer!.listen(0, "127.0.0.1", resolve));
    failingUi = await startLabUiProcess({
      args: ["--timeout", String(TIMEOUT_MS)],
      env: {
        ASKDB_FIXTURE_POSTGRES_PORT: String((silentServer.address() as { port: number }).port),
        ASKDB_FIXTURE_MYSQL_PORT: String(await freePort()),
      },
    });
    return uiRun(failingUi, { question: AGENCY_NAMES });
  })();
  return failingRun;
}

beforeAll(async () => {
  ui = await startLabUiProcess();
});

/** A `lab ui` with the live model: the fake key, and the stand-in's replies. */
const liveStub = stubOpenAiEnv({
  [AGENCY_NAMES]: (JSON.parse(readFileSync(join(LAB, "cassettes", "sqlite", "agency-names.json"), "utf8")) as { reply: string }).reply,
  // A refusal that echoes the key, as OpenAI's does.
  [SATO]: { status: 401 },
  // A write: AskDB rejects it.
  [UNPAID]: '```sql\nDELETE FROM "order" WHERE is_paid = 0\n```',
  // The right rows, but only the inline statement: no sql-unbound block, no manifest.
  [PROGRAMS_SINCE]: "```sql\nSELECT agency_id, program_code FROM program WHERE starts_on >= '2022-01-01' ORDER BY agency_id, program_code\n```",
});
let liveUi: Promise<LabUiProcess> | undefined;
const liveRun = async (input: UiInput) => uiRun(await (liveUi ??= startLabUiProcess({ env: liveStub.env })), input);

afterAll(async () => {
  await Promise.all([ui?.close(), failingUi?.close(), liveUi?.then((u) => u.close())]);
  liveStub.dispose();
  heldSockets.forEach((s) => s.destroy());
  await new Promise((resolve) => (silentServer ? silentServer.close(resolve) : resolve(undefined)));
});

/*
 * Protects: `lab ask` and `lab ui` share one ask → validate → execute module, so an
 * engine's column holds exactly what `pnpm lab ask --db <engine>` prints for the same input
 * (issue #262): the SQL, the validation outcome or the rejecting error class and rule code,
 * the replay server's refusal, and the rows with their count, and the same exit code.
 * Catches: the page drifting into a second implementation: a column built from another
 * model path, prompt or formatter, a rejection or refusal reported differently, or rows
 * that aren't the ones `lab ask` reads.
 * Not covered elsewhere: `lab-ask` and `lab-ask-replay` check `lab ask`'s own output, and
 * nothing checks the page's columns against it.
 */
it.for(DIALECTS)("[%s] lab-ui-same-as-lab-ask: a catalog question", async ([dialect], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const [cli, run] = await Promise.all([labAsk("--db", dialect, TOP_PAID), runOnce({ question: TOP_PAID })]);

  expect(cli.status).toBe(0);
  expect(printed(run, dialect)).toEqual(maskPorts(cli));
});

/*
 * Protects: the page's path switch (#448): a column asked through the client path
 * (`createAskDb` + `@askdb/ai-openai`) holds what `pnpm lab ask --via client` prints, on every
 * engine, so the page tests both documented model paths.
 * Catches: the client path's config read once for the whole server, so every engine after the
 * first asks the first engine's replay URL and gets its SQL; or a `via` the page sends that the
 * server drops, so the "client" column is the raw path's.
 * Not covered elsewhere: the raw-path scenario above; `lab-ask-replay` checks `lab ask --via
 * client` itself, not the page's columns.
 */
it.for(DIALECTS)("[%s] lab-ui-same-as-lab-ask: a catalog question through the client path", async ([dialect], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const [cli, run] = await Promise.all([labAsk("--db", dialect, "--via", "client", TOP_PAID), runOnce({ question: TOP_PAID, via: "client" })]);

  expect(cli.stdout).toContain("via createAskDb() + @askdb/ai-openai");
  expect(cli.status).toBe(0);
  expect(printed(run, dialect)).toEqual(maskPorts(cli));
});

/*
 * Protects: the page's live option (#448). With a key, a live run asks the live model, with
 * that key, through the path picked (both documented paths work end to end), never the replay
 * server; each column ends with the grader's verdict (`gradeCatalogAnswer`), and the summary's
 * oracle chip shows that same verdict, which checks more than the rows (the parameterized
 * question's form, a rejection, which has no rows). A failed model call reaches the page with
 * the key the provider echoed redacted.
 * Catches: a live run that loses the live settings between the page, the server and the engine
 * process and silently replays; a path the live run drops; and a summary that calls an answer
 * a match while its column says the oracle missed it.
 * Not covered elsewhere: `lab-ask-live` covers `lab ask --model live`, not the server or its
 * engine processes; the scenarios above all run the replay model.
 */
it.for([
  ["raw", "model:      live gpt-4o-mini at https://api.openai.com/v1, via createOpenAI() → ask()"],
  ["client", "model:      live, via createAskDb() + @askdb/ai-openai (live/askdb.config.ts)"],
] as const)("[sqlite] lab-ui-live: asks the live model with the key, through the %s path", async ([via, modelLine], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const before = liveStub.requests().length;

  const run = await liveRun({ question: AGENCY_NAMES, model: "live", via, engines: ["sqlite"] });
  const printed = column(run, "sqlite").lines.map((l) => l.text);

  expect(printed).toContain(modelLine);
  expect(printed.at(-1)).toBe("oracle:     pass");
  expect(run.summary?.oracle?.sqlite).toEqual({ verdict: "match" });
  expect(liveStub.requests().slice(before)).toEqual([expect.objectContaining({ question: AGENCY_NAMES, authorized: true })]);
});

it("[sqlite] lab-ui-live: a failed model call reaches the page with the key the provider echoed redacted", async (ctx) => {
  needsCapability(ctx, "cli-introspect-engine");

  const run = await liveRun({ question: SATO, model: "live", via: "client", engines: ["sqlite"] });
  const event = column(run, "sqlite");

  expect(event.status).toBe("refused");
  expect(event.lines.filter((l) => l.stream === "stderr").map((l) => l.text)).toEqual([expect.stringMatching(/^model call failed: SqlGenerationError: .*Incorrect API key provided: \[redacted\]/)]);
  expect(JSON.stringify(run)).not.toContain(STUB_KEY);
});

it.for([
  ["the parameterized question without its parameterized form", PROGRAMS_SINCE, /^oracle: {5}miss — no parameterized form/],
  ["a rejection, which has no rows", UNPAID, /^oracle: {5}miss — rejected \(SqlValidationError SQL_NOT_SELECT_OR_WITH\)$/],
] as const)("[sqlite] lab-ui-live: the summary's oracle verdict is the grader's, which checks more than the rows: %s", async ([, question, verdict], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");

  const run = await liveRun({ question, model: "live", engines: ["sqlite"] });
  const printed = column(run, "sqlite").lines.map((l) => l.text);

  expect(printed.at(-1)).toMatch(verdict);
  expect(run.summary?.oracle?.sqlite).toEqual({ verdict: "mismatch", reason: printed.at(-1)!.replace(/^oracle: {5}miss — /, "") });
});

it.for([
  ["a rejected statement", { question: "", sql: "DELETE FROM org.agency" }, ["--sql", "DELETE FROM org.agency"]],
  ["a question with no reply", { question: NO_REPLY }, [NO_REPLY]],
] as const)("[postgres] lab-ui-same-as-lab-ask: %s", async ([, input, args], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const [cli, run] = await Promise.all([labAsk("--db", "postgres", ...args), runOnce(input)]);

  expect(cli.status).toBe(1);
  expect(printed(run, "postgres")).toEqual(maskPorts(cli));
});

/*
 * Protects: the summary strip's two verdicts (issue #262): whether the engines agree after
 * the fixture's normalization rules (`dataset/NORMALIZATION.md`), and whether each engine
 * matches the oracle computed from the seed data (`src/oracle.ts`), for a catalog question
 * and for raw SQL labelled with one.
 * Catches: an indicator that says "agree" when the engines' rows differ (comparing counts,
 * or skipping an engine), one that says "disagree" over driver-level differences the
 * normalization rules erase (MySQL's string integers, SQL Server's numbers), and an oracle
 * verdict that isn't per engine. The catalog question's paid totals are decimals, which
 * Postgres and MySQL return as strings and SQL Server and SQLite as numbers.
 * Not covered elsewhere: `results.test.ts` compares each engine with the oracle inside the
 * suite; nothing checks what the page tells a contributor.
 * The disagreement is real engine behavior: `LIKE 'a%'` is case-sensitive on Postgres and
 * case-insensitive under the other servers' default collations, so Postgres reads no rows
 * and MySQL, MariaDB and SQL Server read the three `Agência …` rows. SQLite has no `org`
 * schema, so its column reports its own error and it isn't compared.
 * Raw SQL labelled with a question it doesn't answer (three columns for a two-column
 * question) returns the same rows everywhere, so it's not compared rather than shown as a
 * disagreement, and the oracle calls each engine a mismatch.
 */
it.for(DIALECTS)("[%s] lab-ui-summary: every engine agrees and matches the oracle on a catalog question", async ([dialect], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const { summary } = await runOnce({ question: TOP_PAID });

  expect(summary?.questionId).toBe("top-paid-agencies");
  expect(summary?.agreement.verdict).toBe("agree");
  expect(summary?.agreement.groups.map((g) => g.slice().sort())).toEqual([[...SUPPORTED_DIALECTS].sort()]);
  expect(summary?.oracle?.[dialect]).toEqual({ verdict: "match" });
});

const LIKE_SQL = "SELECT agency_id, name FROM org.agency WHERE name LIKE 'a%' ORDER BY agency_id";
const CASE_INSENSITIVE: SupportedDialect[] = ["mariadb", "mysql", "sqlserver"];
const DISAGREEMENT: Record<SupportedDialect, { group?: SupportedDialect[]; oracle: string }> = {
  postgres: { group: ["postgres"], oracle: "mismatch" },
  mysql: { group: CASE_INSENSITIVE, oracle: "mismatch" },
  mariadb: { group: CASE_INSENSITIVE, oracle: "mismatch" },
  sqlserver: { group: CASE_INSENSITIVE, oracle: "mismatch" },
  sqlite: { oracle: "not compared" },
};

it.for(DIALECTS)("[%s] lab-ui-summary: engines that read different rows are shown disagreeing", async ([dialect], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const { summary } = await runOnce({ sql: LIKE_SQL, question: AGENCY_NAMES });
  const want = DISAGREEMENT[dialect];

  expect(summary?.agreement.verdict).toBe("disagree");
  if (want.group) expect(summary?.agreement.groups.find((g) => g.includes(dialect))?.slice().sort()).toEqual(want.group);
  else expect(summary?.agreement.notCompared).toEqual([{ dialect, reason: "failed" }]);
  expect(summary?.oracle?.[dialect]?.verdict).toBe(want.oracle);
});

it.for(DIALECTS)("[%s] lab-ui-summary: rows that don't fit the labelled question aren't compared, not shown disagreeing", async ([dialect], ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const { summary } = await runOnce({ sql: "SELECT 1 AS a, 2 AS b, 3 AS c", question: AGENCY_NAMES });

  expect(summary?.agreement.verdict).toBe("not compared");
  expect(summary?.agreement.notCompared.find((n) => n.dialect === dialect)?.reason).toMatch(/^rows don't fit the question's columns/);
  expect(summary?.oracle?.[dialect]?.verdict).toBe("mismatch");
});

/*
 * Protects: engines run concurrently and fail alone (issue #262): an engine that is down
 * fails in its own column; one that never answers is reported as timed out after
 * `--timeout`, its column sent after the others; the remaining engines still complete,
 * agree and match the oracle.
 * Catches: one engine's error failing the whole run, engines run one after another so a
 * slow one holds the rest back, a hung engine that keeps the run from ever finishing, and a
 * failed engine counted in the agreement.
 * Not covered elsewhere: no other test runs more than one engine at a time.
 */
it("[postgres] lab-ui-isolation: an engine that never answers times out in its own column, after the others", async (ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const run = await runWithEnginesDown();
  const pg = column(run, "postgres");

  expect(pg.status).toBe("timeout");
  expect(pg.error).toBe(`no result after ${TIMEOUT_MS} ms`);
  expect(run.engines.at(-1)?.dialect).toBe("postgres");
});

it("[mysql] lab-ui-isolation: an engine that's down fails in its own column", async (ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const mysql = column(await runWithEnginesDown(), "mysql");

  expect(mysql.status).toBe("failed");
  expect(mysql.error).toMatch(/ECONNREFUSED/);
});

it.for([["mariadb"], ["sqlserver"], ["sqlite"]] as [SupportedDialect][])(
  "[%s] lab-ui-isolation: completes, agrees and matches the oracle while other engines fail",
  async ([dialect], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const run = await runWithEnginesDown();
    const event = column(run, dialect);

    expect(event.status).toBe("ok");
    expect(event.rowCount).toBe(7);
    expect(event.timings.totalMs).toBeLessThan(TIMEOUT_MS);
    expect(run.summary?.agreement.verdict).toBe("agree");
    expect(run.summary?.agreement.groups[0]).toContain(dialect);
    expect(run.summary?.agreement.notCompared.map((n) => n.dialect).slice().sort()).toEqual(["mysql", "postgres"]);
    expect(run.summary?.oracle?.[dialect]).toEqual({ verdict: "match" });
  },
);

/*
 * Protects: `lab ui` stops on SIGTERM (or Ctrl-C) even while an engine's connection still
 * hangs, as the isolation run above leaves Postgres's.
 * Catches: a shutdown that closes only the HTTP server, so the timed-out engine's socket
 * keeps the process alive until someone kills it.
 * Not covered elsewhere: every other test stops the server with nothing left running.
 * Runs after the isolation scenarios, which start the run it stops.
 */
it("[postgres] lab-ui-shutdown: exits on SIGTERM while a timed-out engine's connection still hangs", async (ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  await runWithEnginesDown();

  expect(await failingUi!.stop(), "lab ui ignored SIGTERM and had to be killed").toEqual({ forced: false });
});

/*
 * Protects: the page and `lab ask` run exactly the input they were given (issues #262, #448).
 * Blank SQL is refused (`400` from the page, usage and exit 2 from `lab ask --sql ""`), not run
 * as the question it's labelled with; so are a model, a path or an engine the server doesn't
 * know, no engine at all, and SQL sent for the live model, which SQL doesn't call. Only the
 * engines picked run, and the summary compares only them.
 * Catches: blank SQL silently dropped, so the label's replay question runs instead and rows
 * appear for SQL nobody wrote; an unknown model or path quietly replaced by the default, so a
 * contributor reads replay or raw-path results as the ones they picked; and engines left out
 * of the pick that run anyway.
 * Not covered elsewhere: the other runs all send valid input, on every engine.
 */
it.for([
  ["blank SQL", { question: AGENCY_NAMES, sql: "   " }],
  ["an unknown model", { question: AGENCY_NAMES, model: "gpt-4o" }],
  ["an unknown path", { question: AGENCY_NAMES, via: "http" }],
  ["an unknown engine", { question: AGENCY_NAMES, engines: ["sqlite", "oracle"] }],
  ["no engine", { question: AGENCY_NAMES, engines: [] }],
  ["SQL for the live model", { question: AGENCY_NAMES, sql: "SELECT 1", model: "live" }],
] as const)("[postgres] lab-ui-input: refuses %s", async ([, input]) => {
  const run = await uiRun(ui, input as unknown as UiInput);

  expect(run.status).toBe(400);
});

it("[postgres] lab-ui-input: runs only the engines picked, and compares only them", async (ctx) => {
  needsCapability(ctx, "cli-introspect-engine");
  const run = await uiRun(ui, { question: AGENCY_NAMES, engines: ["sqlite", "mariadb"] });

  expect(run.engines.map((e) => e.dialect).sort()).toEqual(["mariadb", "sqlite"]);
  expect(run.summary?.agreement.verdict).toBe("agree");
  expect(Object.keys(run.summary?.oracle ?? {}).sort()).toEqual(["mariadb", "sqlite"]);
});

it("[postgres] lab-ui-input: lab ask refuses a blank --sql, as the page does", async () => {
  const run = await lab(["ask", "--db", "postgres", "--sql", "", AGENCY_NAMES]);

  expect(run.status).toBe(2);
  expect(run.stderr).toContain("usage: pnpm lab");
  expect(run.stdout).toBe("");
});

/*
 * Protects: `lab ui` refuses an option it can't honor, printing its usage and exiting 2: a
 * blank `--port` or one outside 0–65535, a `--timeout` longer than Node's timer limit, an
 * option with no value, an unknown option and an extra argument.
 * Catches: a blank `--port` quietly read as 0 (a random port), a port the bind then crashes
 * on, a `--timeout` Node cuts to 1 ms, so every engine times out at once, and a parse error
 * that escapes as a stack trace.
 * Not covered elsewhere: every other test starts `lab ui` with valid options. The longest
 * timeout Node can hold starts the server; one millisecond more is refused.
 */
it.for([
  ["a blank --port", ["--port", ""]],
  ["--port 65536", ["--port", "65536"]],
  ["a --timeout beyond Node's timer limit", ["--timeout", String(2 ** 31)]],
  ["--port with no value", ["--port"]],
  ["an unknown option", ["--verbose"]],
  ["an extra argument", ["extra"]],
] as const)("[postgres] lab-ui-options: refuses %s", async ([, args]) => {
  // A refused option exits within seconds; a server that starts instead is killed before the test times out.
  const run = await lab(["ui", ...args], 90_000);

  expect(run.status).toBe(2);
  expect(run.stderr).toContain("pnpm lab ui [--port <port>] [--timeout <ms>]");
});

it("[postgres] lab-ui-options: accepts the longest --timeout Node can hold", async () => {
  const longest = await startLabUiProcess({ args: ["--timeout", String(2 ** 31 - 1)] });
  try {
    expect((await studioRequest(longest)).status).toBe(200);
  } finally {
    await longest.close();
  }
});

/*
 * Protects: the page names what it tests (issues #262, #448): the install target `lab:use`
 * recorded, and whether the live model is available. Without a key (or in CI) the page says
 * why, and the API refuses a live run (`409`) before any engine runs, never falling back to
 * replay.
 * Catches: a page that names a stale or hard-coded target, so a contributor reads one
 * version's results as another's; and a live run with no key that silently replays, or starts
 * every engine only for each to fail.
 * Not covered elsewhere: `lab ask` prints its target; nothing checks the page's.
 * `record.test.ts` owns `liveSettings`' CI and no-key rules; this checks the page acting on them.
 */
it("[postgres] lab-ui-page: names the install target, and why the live model is unavailable", async () => {
  const page = await studioRequest(ui);
  const shown = (id: string) => new RegExp(`<dd id="${id}">([^<]*)</dd>`).exec(page.text)?.[1];

  expect(page.status).toBe(200);
  expect(shown("target")).toBe(requireInstallTarget().label);
  expect(shown("live-model")).toMatch(/^unavailable: live mode needs an OpenAI API key and found none/);
});

it("[postgres] lab-ui-page: refuses a live run without a key, running no engine", async () => {
  // Checked first, so a server that found a key fails here instead of making a paid call.
  expect(/<dd id="live-model">unavailable: /.test((await studioRequest(ui)).text), "lab ui found a key: refusing to send a live run").toBe(true);
  const reply = await studioRequest(ui, {
    method: "POST",
    path: "/api/run",
    headers: { "content-type": "application/json", origin: ui.origin },
    body: JSON.stringify({ question: AGENCY_NAMES, model: "live" }),
  });

  expect(reply.status).toBe(409);
  expect(reply.text).toMatch(/^lab ui: the live model is unavailable: live mode needs an OpenAI API key/);
});

/*
 * Protects: the local-server rules issue #262 takes from ADR 0009: the server listens on
 * 127.0.0.1 only, never a wildcard address, and refuses a foreign `Host` on every request,
 * the page included (DNS rebinding). `POST /api/run` also refuses a cross-site `Origin` and a
 * body that isn't `application/json` (a CORS-simple cross-site POST).
 * Catches: a bind to `0.0.0.0` or `::` that exposes the lab to the network, a Host check
 * missing from the page or the API, and cross-site requests that make the browser run SQL.
 * Not covered elsewhere: the Studio suite checks Studio's guard, not the lab's.
 * Each refusal is one header away from a request the same test shows getting past the
 * guards (the page, `200`; an empty input, `400` from the input check after them).
 */
it("[postgres] lab-ui-local-only: listens on loopback only", async () => {
  const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
  expect(lan, "no non-loopback IPv4 interface to try the port on").toBeDefined();
  const reaches = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port: ui.port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });

  expect(await reaches("127.0.0.1")).toBe(true);
  expect(await reaches(lan!)).toBe(false);
});

const PAGE = { method: "GET", path: "/", body: undefined, passes: 200 };
const API = { method: "POST", path: "/api/run", body: "{}", passes: 400 };
/** The headers the page itself sends. */
const pageHeaders = () => ({ host: `127.0.0.1:${ui.port}`, origin: ui.origin, "content-type": "application/json" });

it.for([
  ["the page from a rebound Host", PAGE, { host: "rebound.example" }, 403],
  ["the API from a rebound Host", API, { host: "rebound.example" }, 403],
  ["the API from a cross-site Origin", API, { origin: "https://evil.example" }, 403],
  ["the API with a text/plain body", API, { "content-type": "text/plain" }, 415],
] as const)("[postgres] lab-ui-local-only: refuses %s", async ([, route, change, status]) => {
  const send = (headers: Record<string, string>) => studioRequest(ui, { method: route.method, path: route.path, body: route.body, headers });
  const own = pageHeaders();
  const changed = { ...own, ...change, ...("host" in change ? { host: `${change.host}:${ui.port}` } : {}) };

  expect((await send(own)).status).toBe(route.passes);
  expect((await send(changed)).status).toBe(status);
});

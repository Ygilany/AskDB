/**
 * `pnpm lab ask --model live` (#448): what a live answer prints, and when the CLI refuses to
 * ask at all.
 *
 * Protects: `lab ask --model live` asks the live model, through either documented path, with
 * the key and model `liveSettings` read, never the replay server; and through the shared ask → validate
 * → execute module (`src/ask-run.ts`) it prints the model and path, then for a catalog
 * question the oracle's verdict (`gradeCatalogAnswer`): `pass`, or the miss and its reason, a
 * validation rejection included, and SQL the engine refuses, which is graded rather than
 * failing the run. A question outside the catalog says it has no oracle. Exit codes: 0 when
 * the SQL ran (a miss is model quality), 1 for a rejection, SQL the engine refused, or a
 * failed model call, which is reported as that, not as a validation outcome, with the key
 * the provider echoed redacted. The CLI refuses before anything runs, exit 2: in CI, without a key, for a
 * `--model` other than `replay|live`, and for `--model live` with `--sql`, which calls no
 * model (and `askAndRun` itself refuses that pair, rather than grade SQL no model wrote). `LAB_LIVE_MODEL=1` alone doesn't switch `lab ask` to the live model (maintainer
 * decision on #448): only the flag spends.
 * Catches: `--model live` that loses the live settings on the way in and silently replays; the
 * two paths asking different models; a live answer the engine refuses that crashes the run; a
 * live run that prints a key a provider echoed; a bad key reported as AskDB rejecting SQL; a
 * live answer with no verdict, or a miss that fails the exit code; a refusal that runs
 * introspection first or falls back to replay; and an exported `LAB_LIVE_MODEL=1` that makes
 * every `lab ask` a paid call.
 * Not covered elsewhere: `lab-ask-replay.test.ts` covers the replay model only; `live.test.ts`
 * asks the real model, only with `LAB_LIVE_MODEL=1`, and never through `lab ask`;
 * `record.test.ts` owns `liveSettings` itself (the CI and no-key rules) and `grade.test.ts`
 * the verdicts, which this checks only as `lab ask` prints them.
 * No production seam: the stand-in for OpenAI (`support/stub-openai-fetch.mjs`) replaces
 * `fetch` for `api.openai.com` and nothing else, in this process for the verdict cases and,
 * preloaded with `NODE_OPTIONS`, in the `lab ask` processes this spawns. It accepts only its
 * fake key, so no test needs a key or the network, and none can spend. Every spawned run has
 * an `OPENAI_API_KEY`, the fake one or an empty one, which wins over `.env.live`. The replies
 * run on SQLite, whose fixture copy is this checkout's own, so each scenario is one `[sqlite]`
 * cell in the matrix (the refusals need no engine, and take the same cell).
 *
 * Not covered: a guarantee violation (exit 1): no SQL AskDB accepts makes the host refuse a
 * write today, so no reply reaches it (`grade.test.ts` owns the verdict).
 *
 * Needs `cli-introspect-engine` (the SQLite artifact) and an installed lab (`pnpm lab:use .`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askAndRun } from "../src/ask-run.js";
import { needsCapability } from "../src/capabilities.js";
import { findQuestion } from "../src/model/catalog.js";
import { OPENAI_BASE_URL, type LiveSettings } from "../src/model/live.js";
import { LAB_ROOT } from "../src/paths.js";
import { installOpenAiStub } from "./support/stub-openai-fetch.mjs";
import { STUB_KEY, stubOpenAiEnv, type StubReplies } from "./support/stub-openai.js";

const text = (id: string) => findQuestion(id)!.text;
const fence = (sql: string) => `\`\`\`sql\n${sql}\n\`\`\``;
const FREE_TEXT = "How many agencies are there?";
const live: LiveSettings = { apiKey: STUB_KEY, modelId: "gpt-4o-mini", baseURL: OPENAI_BASE_URL };

/** What the stand-in answers to each question: a reply, or a 401 that echoes the key. */
const REPLIES: StubReplies = {
  // The authored reply: passes.
  [text("agency-names")]: (JSON.parse(readFileSync(join(LAB_ROOT, "cassettes", "sqlite", "agency-names.json"), "utf8")) as { reply: string }).reply,
  // Every program, not only the active ones: wrong rows.
  [text("active-programs-per-agency")]: fence("SELECT agency_id, COUNT(*) AS programs FROM program GROUP BY agency_id"),
  // A write: AskDB rejects it.
  [text("unpaid-orders")]: fence('DELETE FROM "order" WHERE is_paid = 0'),
  // A column the table doesn't have: AskDB passes it, the engine refuses it.
  [text("top-five-orders")]: fence('SELECT order_id, no_such_column FROM "order"'),
  [FREE_TEXT]: fence("SELECT COUNT(*) AS agencies FROM agency"),
  [text("client-named-sato")]: { status: 401 },
};

let stub: ReturnType<typeof installOpenAiStub>;
beforeAll(() => {
  stub = installOpenAiStub({ replies: REPLIES, key: STUB_KEY });
});
afterAll(() => stub?.restore());

describe("[sqlite] lab-ask-live", () => {
  it.for([
    ["a catalog question it answers right", text("agency-names"), "ok", 0, /^oracle: {5}pass$/],
    ["a catalog question it answers with the wrong rows", text("active-programs-per-agency"), "ok", 0, /^oracle: {5}miss — wrong rows \(got \d+, expected \d+\)$/],
    ["a catalog question it answers with SQL AskDB rejects", text("unpaid-orders"), "rejected", 1, /^oracle: {5}miss — rejected \(SqlValidationError SQL_NOT_SELECT_OR_WITH\)$/],
    ["a catalog question it answers with SQL the engine refuses", text("top-five-orders"), "rejected", 1, /^oracle: {5}miss — SQL error: .*no_such_column/],
    ["a question outside the catalog", FREE_TEXT, "ok", 0, /^oracle: {5}none \(not a catalog question\)$/],
  ] as const)("ends %s with the oracle's verdict", async ([, question, status, exitCode, verdict], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = await askAndRun("sqlite", { question, live });

    expect(run.lines.map((l) => l.text).at(-1)).toMatch(verdict);
    expect(run.status).toBe(status);
    expect(run.exitCode).toBe(exitCode);
  });

  it("refuses live together with sql, which calls no model, instead of grading that SQL as the model's", async () => {
    const before = stub.requests.length;

    await expect(askAndRun("sqlite", { question: text("agency-names"), sql: "SELECT 1", live })).rejects.toThrow(/`sql` calls no model/);
    expect(stub.requests.length).toBe(before);
  });

  it("shows a rejected answer's reply, since a rejection carries no SQL", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = await askAndRun("sqlite", { question: text("unpaid-orders"), live });

    expect(run.lines.map((l) => l.text)).toContain(`reply:      ${REPLIES[text("unpaid-orders")] as string}`.replace(/\n/g, `\n${" ".repeat(12)}`));
  });

  it("reports a failed model call as that, exit 1, with the key the provider echoed redacted", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = await askAndRun("sqlite", { question: text("client-named-sato"), live });

    expect(run.lines.filter((l) => l.stream === "stderr").map((l) => l.text)).toEqual([expect.stringMatching(/^model call failed: SqlGenerationError: .*Incorrect API key provided: \[redacted\]/)]);
    expect(run.lines.map((l) => l.text).join("\n")).not.toMatch(/validation:|oracle:/);
    expect(JSON.stringify(run.lines) + String((run.error as Error).message)).not.toContain(STUB_KEY);
    expect(run.status).toBe("refused");
    expect(run.exitCode).toBe(1);
  });
});

/** `pnpm lab ask`, spawned the way `pnpm lab` runs it. With no `env`, it has no key from the shell or `.env.live` (an empty variable wins over the file). */
function labAsk(args: string[], env: Record<string, string> = {}) {
  const run = spawnSync(join(LAB_ROOT, "node_modules", ".bin", "tsx"), [join(LAB_ROOT, "src", "lab-cli.ts"), "ask", "--db", "sqlite", ...args], {
    cwd: LAB_ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "", GITHUB_ACTIONS: "", OPENAI_API_KEY: "", LAB_LIVE_MODEL: "", ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("[sqlite] lab-ask-live-spawned", () => {
  const spawned = stubOpenAiEnv(REPLIES);
  afterAll(() => spawned.dispose());

  /** Not AskDB's default, so a path that drops `LAB_LIVE_MODEL_ID` asks the wrong model. */
  const MODEL_ID = "gpt-4.1-mini";

  it.for([
    ["raw", `model:      live ${MODEL_ID} at https://api.openai.com/v1, via createOpenAI() → ask()`],
    ["client", "model:      live, via createAskDb() + @askdb/ai-openai (live/askdb.config.ts)"],
  ] as const)("asks the live model with the key and model it read, through the %s path", ([via, modelLine], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const before = spawned.requests().length;

    const run = labAsk(["--model", "live", "--via", via, text("agency-names")], { ...spawned.env, LAB_LIVE_MODEL_ID: MODEL_ID });

    expect(run.stdout.split("\n")).toContain(modelLine);
    expect(run.stdout.trimEnd().split("\n").at(-1)).toBe("oracle:     pass");
    expect(spawned.requests().slice(before)).toEqual([expect.objectContaining({ question: text("agency-names"), model: MODEL_ID, authorized: true })]);
    expect(run.status).toBe(0);
  });

  // The in-process case covers the raw path; this is the client path's own failure report, in the CLI's own output.
  it("reports the client path's failed model call with the key the provider echoed redacted, exit 1", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = labAsk(["--model", "live", "--via", "client", text("client-named-sato")], spawned.env);

    expect(run.stderr).toMatch(/^model call failed: SqlGenerationError: .*Incorrect API key provided: \[redacted\]/m);
    expect(run.stdout + run.stderr).not.toContain(STUB_KEY);
    expect(run.status).toBe(1);
  });
});

describe("[sqlite] lab-ask-live-refusals", () => {
  // Nothing printed on stdout: no target line, so nothing ran.
  it.for([
    ["a CI run", ["--model", "live", "q"], { CI: "true" }, /^lab ask: live mode calls a real model and never runs in CI/],
    ["no key", ["--model", "live", "q"], {}, /^lab ask: live mode needs an OpenAI API key and found none: .*doesn't fall back to the replay model/],
    ["a --model other than replay or live", ["--model", "gpt-4o", "q"], {}, /^usage: pnpm lab ask/],
    ["--model live with --sql, which calls no model", ["--model", "live", "--sql", "SELECT 1"], {}, /^usage: pnpm lab ask/],
  ] as const)("exits 2 for %s, before anything runs", ([, args, env, message]) => {
    const run = labAsk([...args], env);

    expect(run.stderr).toMatch(message);
    expect(run.stdout).toBe("");
    expect(run.status).toBe(2);
  });

  it("stays on the replay model with LAB_LIVE_MODEL=1 and no --model", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = labAsk([text("agency-names")], { LAB_LIVE_MODEL: "1" });

    expect(run.stdout).toMatch(/^model: {6}replay at /m);
    expect(run.status).toBe(0);
  });
});

/**
 * `pnpm lab ask --model live` (#448): what a live answer prints, and when the CLI refuses to
 * ask at all.
 *
 * Protects: a live answer goes through the shared ask → validate → execute module
 * (`src/ask-run.ts`) on the raw-model path, to the provider `liveSettings` names, with its key,
 * and prints the model and path, then for a catalog question the oracle's verdict
 * (`gradeCatalogAnswer`): `pass`, or the miss and its reason, a validation rejection included.
 * A question outside the catalog says it has no oracle. Exit codes: 0 when the SQL ran (a miss
 * is model quality), 1 for a rejection or a failed model call, which is reported as that, not
 * as a validation outcome, with the key the provider echoed redacted. The CLI refuses before
 * anything runs, exit 2: in CI, without a key, for a `--model` other than `replay|live`, and
 * for `--model live` with `--sql`, which calls no model. `LAB_LIVE_MODEL=1` alone doesn't
 * switch `lab ask` to the live model (maintainer decision on #448): only the flag spends.
 * Catches: a live run that prints a key a provider echoed; a bad key reported as AskDB
 * rejecting SQL; a live answer with no verdict, or a miss that fails the exit code; a refusal
 * that runs introspection first or falls back to replay; and an exported `LAB_LIVE_MODEL=1`
 * that makes every `lab ask` a paid call.
 * Not covered elsewhere: `lab-ask-replay.test.ts` covers the replay model only; `live.test.ts`
 * asks the real model, only with `LAB_LIVE_MODEL=1`, and never through `lab ask`;
 * `record.test.ts` owns `liveSettings` itself (the CI and no-key rules) and `grade.test.ts`
 * the verdicts, which this checks only as `lab ask` prints them.
 * No production seam: `askAndRun` takes the live settings `lab ask` reads with `liveSettings`;
 * here they name a local stand-in provider instead of OpenAI, so no key and no network are
 * needed. The stand-in answers each question with a chosen reply, run on SQLite, whose fixture
 * copy is this checkout's own. The CLI cases spawn `src/lab-cli.ts` with an empty key, which
 * wins over `.env.live`, so a regression can't make a paid call.
 *
 * Not covered: the client path to the live model. `live/askdb.config.ts` has no base URL to
 * point at a stand-in, and adding one only for tests would be a seam; the PR shows a real run.
 * A guarantee violation (exit 1): no SQL AskDB accepts makes the host refuse a write today, so
 * no reply reaches it (`grade.test.ts` owns the verdict).
 *
 * Needs `cli-introspect-engine` (the SQLite artifact) and an installed lab (`pnpm lab:use .`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askAndRun } from "../src/ask-run.js";
import { needsCapability } from "../src/capabilities.js";
import { findQuestion } from "../src/model/catalog.js";
import type { LiveSettings } from "../src/model/live.js";
import { LAB_ROOT } from "../src/paths.js";

const KEY = "sk-lab-test-0123456789abcdefghij";
const text = (id: string) => findQuestion(id)!.text;
const fence = (sql: string) => `\`\`\`sql\n${sql}\n\`\`\``;
const FREE_TEXT = "How many agencies are there?";

/** What the stand-in provider answers to each question: a reply, or a 401 that echoes the key. */
const REPLIES: Record<string, string | { status: 401 }> = {
  // The authored reply: passes.
  [text("agency-names")]: (JSON.parse(readFileSync(join(LAB_ROOT, "cassettes", "sqlite", "agency-names.json"), "utf8")) as { reply: string }).reply,
  // Every program, not only the active ones: wrong rows.
  [text("active-programs-per-agency")]: fence("SELECT agency_id, COUNT(*) AS programs FROM program GROUP BY agency_id"),
  // A write: AskDB rejects it.
  [text("unpaid-orders")]: fence('DELETE FROM "order" WHERE is_paid = 0'),
  [FREE_TEXT]: fence("SELECT COUNT(*) AS agencies FROM agency"),
  [text("client-named-sato")]: { status: 401 },
};

const authorizations: string[] = [];
let upstream: ReturnType<typeof createServer>;
let live: LiveSettings;

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    authorizations.push(req.headers.authorization ?? "");
    const reply = Object.entries(REPLIES).find(([question]) => body.includes(JSON.stringify(question).slice(1, -1)))?.[1] ?? fence("SELECT 1");
    if (typeof reply === "object") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.`, code: "invalid_api_key" } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "r1", object: "response", created_at: 1, model: "gpt-4o-mini-2024-07-18", status: "completed", incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: reply, annotations: [] }] }],
      }),
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  live = { apiKey: KEY, modelId: "gpt-4o-mini", baseURL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1` };
});

afterAll(async () => {
  upstream?.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe("lab ask --model live", () => {
  it.for([
    ["a catalog question it answers right", text("agency-names"), "ok", 0, /^oracle: {5}pass$/],
    ["a catalog question it answers with the wrong rows", text("active-programs-per-agency"), "ok", 0, /^oracle: {5}miss — wrong rows \(got \d+, expected \d+\)$/],
    ["a catalog question it answers with SQL AskDB rejects", text("unpaid-orders"), "rejected", 1, /^oracle: {5}miss — rejected \(SqlValidationError SQL_NOT_SELECT_OR_WITH\)$/],
    ["a question outside the catalog", FREE_TEXT, "ok", 0, /^oracle: {5}none \(not a catalog question\)$/],
  ] as const)("asks the live model through the raw path and ends %s with the oracle's verdict", async ([, question, status, exitCode, verdict], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    authorizations.length = 0;

    const run = await askAndRun("sqlite", { question, live });
    const printed = run.lines.map((l) => l.text);

    expect(printed).toContain(`model:      live gpt-4o-mini at ${live.baseURL}, via createOpenAI() → ask()`);
    expect(authorizations).toEqual([`Bearer ${KEY}`]);
    expect(printed.at(-1)).toMatch(verdict);
    expect(run.status).toBe(status);
    expect(run.exitCode).toBe(exitCode);
  });

  it("shows a rejected answer's reply, since a rejection carries no SQL", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = await askAndRun("sqlite", { question: text("unpaid-orders"), live });

    expect(run.lines.map((l) => l.text)).toContain(`reply:      ${REPLIES[text("unpaid-orders")]}`.replace(/\n/g, `\n${" ".repeat(12)}`));
  });

  it("reports a failed model call as that, exit 1, with the key the provider echoed redacted", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");

    const run = await askAndRun("sqlite", { question: text("client-named-sato"), live });

    expect(run.lines.filter((l) => l.stream === "stderr").map((l) => l.text)).toEqual([expect.stringMatching(/^model call failed: SqlGenerationError: .*Incorrect API key provided: \[redacted\]/)]);
    expect(run.lines.map((l) => l.text).join("\n")).not.toMatch(/validation:|oracle:/);
    expect(JSON.stringify(run.lines) + String((run.error as Error).message)).not.toContain(KEY);
    expect(run.status).toBe("refused");
    expect(run.exitCode).toBe(1);
  });
});

describe("lab ask's --model refusals", () => {
  /** `pnpm lab ask`, spawned the way `pnpm lab` runs it, with no key from the shell or `.env.live` (an empty variable wins over the file). */
  function labAsk(args: string[], env: Record<string, string> = {}) {
    const run = spawnSync(join(LAB_ROOT, "node_modules", ".bin", "tsx"), [join(LAB_ROOT, "src", "lab-cli.ts"), "ask", "--db", "sqlite", ...args], {
      cwd: LAB_ROOT,
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", OPENAI_API_KEY: "", LAB_LIVE_MODEL: "", ...env },
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

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

/**
 * `pnpm lab:record`'s gate (#247): what it writes, what it refuses, and where the key may go.
 *
 * Protects: a recorded reply reaches `cassettes/` only when it passes the same checks as the
 * results suite (`src/grade.ts`: its SQL, run as the host, returns the oracle's rows, and the
 * parameterized question comes back parameterized), and it carries `"source": "recorded"` and
 * `recordedWith` (the model the provider says answered, the install target, the date). A miss
 * (wrong rows, a validation rejection, no parameterized form) is listed with its reason and
 * leaves the cassette alone. Only the catalog is recorded: the tenant and sensitive suites'
 * hand-written replies can't be asked for, and a refusal makes no call. A provider error stops
 * the run, and so does any other error (the fixture, a model call AskDB couldn't make), keeping
 * what the run did. A reply whose ```sql fence doesn't hold exactly the SQL `ask()` returned is
 * a miss, because the replay suites read the fence strictly. The parameterized question's reply
 * passes with any placeholder name and misses when its unbound form selects other rows. The key
 * never reaches what lab:record writes: a reply holding it is not recorded, and is listed
 * redacted. The CLI exits 2 on a refusal before any call, and 1 when the run stopped or broke a
 * guarantee, and `.lab/record-misses.json` lists what an aborted run found. Neither mode runs in
 * CI, and a missing key is a clear error, never a fallback to the replay model.
 * Catches: a recorder that writes whatever the model said, so a wrong reply turns CI red (or,
 * worse, an authored reply that proved something is replaced by one that doesn't); a cassette
 * without its model, target or date; a stray `--only tenant-unfiltered` replacing an attacker
 * reply with a model's polite one; a key echoed by the provider reaching the terminal; and a
 * live run that starts in CI or silently replays.
 * Not covered elsewhere: `replay-server.test.ts` checks the proxy's wire behavior, not what
 * lab:record does with a reply; `results.test.ts` checks the cassettes on disk after review.
 * No production seam: AskDB is driven through `ask()` with a raw `LanguageModel`, as lab:record
 * does. The provider is a local stand-in that answers each catalog question with a chosen reply,
 * so no key and no network are needed, and the cassettes go to a temp directory. The replies run
 * on SQLite, whose fixture copy is this checkout's own. The CLI cases spawn `src/record-cli.ts`
 * only on paths that stop before a key is read.
 *
 * Not covered: a guarantee violation during recording. No SQL that AskDB accepts makes a host
 * refuse a write today, so no reply can reach that branch; `grade.test.ts` owns the verdict, and
 * `writeRecordReport`'s exit code for a violation is checked here.
 *
 * Needs `cli-introspect-engine` (the SQLite artifact) and an installed lab (`pnpm lab:use .`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { needsCapability } from "../src/capabilities.js";
import { loadQuestions } from "../src/model/catalog.js";
import { LiveModelError, liveSettings, type LiveSettings } from "../src/model/live.js";
import { LAB_ROOT } from "../src/paths.js";
import { RecordAbort, RecordRefusal, portableTarget, record, writeRecordReport, type RecordOutcome } from "../src/record.js";

const KEY = "sk-lab-test-0123456789abcdefghij";
const MODEL = "gpt-4o-mini-2024-07-18";
const CATALOG = loadQuestions();
const text = (id: string) => CATALOG.find((q) => q.id === id)!.text;
const sqlite = (id: string) => (JSON.parse(readFileSync(join(import.meta.dirname, "..", "cassettes", "sqlite", `${id}.json`), "utf8")) as { reply: string }).reply;
const fence = (sql: string) => `\`\`\`sql\n${sql}\n\`\`\``;

/** The authored SQLite reply with a semicolon before its fence closes: `ask()` strips it, the replay suites wouldn't. */
const withSemicolon = (reply: string) => reply.replace(/\n```/, ";\n```");

/** What the stand-in provider answers to each catalog question. */
const REPLIES: Record<string, string> = {
  // The authored reply: passes.
  "agency-names": sqlite("agency-names"),
  // Every program, not only the active ones: wrong rows.
  "active-programs-per-agency": fence("SELECT agency_id, COUNT(*) AS programs FROM program GROUP BY agency_id"),
  // A write: AskDB rejects it.
  "unpaid-orders": fence('DELETE FROM "order" WHERE is_paid = 0'),
  // The right rows, but only the inline statement: no sql-unbound block, no manifest.
  "programs-started-since": fence("SELECT agency_id, program_code FROM program WHERE starts_on >= '2022-01-01' ORDER BY agency_id, program_code"),
  // A reply that somehow holds the key: never written.
  "open-enrollments": `${fence("SELECT client_id, program_code FROM enrollment WHERE exited_on IS NULL")}\n-- ${KEY}`,
  // The right rows, but the fence holds "…;", which the replay suites would read as other SQL.
  "top-five-orders": withSemicolon(sqlite("top-five-orders")),
};

/** Per-test overrides: another reply, a 401, or a 200 with an empty body. */
const override: Record<string, string | { status: 401 } | { empty: true }> = {};

const calls: string[] = [];
let upstream: ReturnType<typeof createServer>;
let settings: LiveSettings;

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const id = CATALOG.find((q) => body.includes(JSON.stringify(q.text).slice(1, -1)))?.id ?? "?";
    calls.push(id);
    const behavior = override[id] ?? REPLIES[id] ?? fence("SELECT 1");
    if (typeof behavior === "object" && "status" in behavior) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.`, code: "invalid_api_key" } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (typeof behavior === "object") return res.end("{}");
    res.end(
      JSON.stringify({
        id: "r1", object: "response", created_at: 1, model: MODEL, status: "completed", incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: behavior, annotations: [] }] }],
      }),
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  settings = { apiKey: KEY, modelId: "gpt-4o-mini", baseURL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1` };
});

afterAll(async () => {
  upstream?.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

const dirs: string[] = [];
function freshDir(): string {
  dirs.push(mkdtempSync(join(tmpdir(), "lab-record-")));
  return dirs.at(-1)!;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const written = (root: string) => (existsSync(join(root, "sqlite")) ? readdirSync(join(root, "sqlite")).sort() : []);

/** Run `fn` with these stand-in overrides, then remove them. */
async function withOverride<T>(entries: typeof override, fn: () => Promise<T>): Promise<T> {
  Object.assign(override, entries);
  try {
    return await fn();
  } finally {
    for (const id of Object.keys(entries)) delete override[id];
  }
}

describe("lab:record", () => {
  it("writes only the replies that pass the results suite's checks, with the model, target and date, and lists each miss", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const cassettesDir = freshDir();
    const ids = Object.keys(REPLIES);

    const outcome = await record({ settings, dialects: ["sqlite"], only: ids, target: "lab-test-target", cassettesDir });

    expect(written(cassettesDir)).toEqual(["agency-names.json"]);
    expect(JSON.parse(readFileSync(join(cassettesDir, "sqlite", "agency-names.json"), "utf8"))).toEqual({
      question: text("agency-names"),
      reply: REPLIES["agency-names"],
      source: "recorded",
      recordedWith: { model: MODEL, askdbTarget: "lab-test-target", at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
    expect(Object.fromEntries(outcome.misses.map((m) => [m.id, m.reason]))).toEqual({
      "active-programs-per-agency": expect.stringMatching(/^wrong rows \(got \d+, expected \d+\)$/),
      "unpaid-orders": "rejected (SqlValidationError SQL_NOT_SELECT_OR_WITH)",
      "programs-started-since": expect.stringMatching(/^no parameterized form/),
      "open-enrollments": expect.stringMatching(/holds the API key/),
      "top-five-orders": expect.stringMatching(/fence doesn't hold exactly the SQL ask\(\) returned/),
    });
    expect(outcome.misses.find((m) => m.id === "unpaid-orders")?.reply).toBe(REPLIES["unpaid-orders"]);
    expect(outcome.violations).toEqual([]);
    // The misses go to .lab/record-misses.json: a reply holding the key is listed redacted.
    expect(JSON.stringify(outcome)).not.toContain(KEY);

    // The same reply from the same model again: nothing to rewrite but the date.
    const again = await record({ settings, dialects: ["sqlite"], only: ["agency-names"], target: "lab-test-target", cassettesDir });
    expect(again).toMatchObject({ written: [], unchanged: [{ dialect: "sqlite", id: "agency-names" }] });
  });

  // AskDB drops an unbound block that disagrees with the inline SQL, so the reply comes back unparameterized: a miss either way.
  it("records the parameterized question's reply whatever its placeholder is called, and misses one whose unbound form selects other rows", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const cassettesDir = freshDir();
    const renamed = sqlite("programs-started-since").replaceAll(":start_date", ":since_date").replace('"name":"start_date"', '"name":"since_date"');
    const wrongUnbound = renamed.replace(/(```sql-unbound[\s\S]*?)starts_on >= :since_date/, "$1starts_on < :since_date");

    const passed = await withOverride({ "programs-started-since": renamed }, () => record({ settings, dialects: ["sqlite"], only: ["programs-started-since"], target: "t", cassettesDir }));
    const missed = await withOverride({ "programs-started-since": wrongUnbound }, () => record({ settings, dialects: ["sqlite"], only: ["programs-started-since"], target: "t", cassettesDir: freshDir() }));

    expect(renamed).toContain(":since_date");
    expect(wrongUnbound).toContain("starts_on < :since_date");
    expect(passed.written).toEqual([{ dialect: "sqlite", id: "programs-started-since" }]);
    expect(JSON.parse(readFileSync(join(cassettesDir, "sqlite", "programs-started-since.json"), "utf8")).reply).toBe(renamed);
    expect(missed.written).toEqual([]);
    expect(missed.misses.map((m) => m.reason)).toEqual([expect.stringMatching(/^no parameterized form/)]);
  });

  it("records the install target without the recorder's local paths", () => {
    const packages = [{ name: "@askdb/core", version: "1.0.0-beta.43" }, { name: "askdb", version: "1.0.0-beta.43" }];
    expect(portableTarget({ label: "checkout /Users/me/code/AskDB @ b14da348 (main)", packages })).toBe("askdb@1.0.0-beta.43, checkout @ b14da348 (main)");
    expect(portableTarget({ label: "checkout /Users/Jane Doe/code/AskDB @ b14da348 (main)", packages })).toBe("askdb@1.0.0-beta.43, checkout @ b14da348 (main)");
    expect(portableTarget({ label: "npm:latest", packages })).toBe("askdb@1.0.0-beta.43, npm:latest");
  });

  it.each([["tenant-unfiltered"], ["sensitive-client-ssns"], ["no-such-question"]])("refuses --only %s before calling the model", async (id) => {
    calls.length = 0;

    const run = record({ settings, dialects: ["sqlite"], only: [id], target: "t", cassettesDir: freshDir() });

    await expect(run).rejects.toThrow(RecordRefusal);
    await expect(run).rejects.toThrow(id.startsWith("no-") ? /not in .*questions\.json/ : /hand-written test replies/);
    expect(calls).toEqual([]);
  });

  // What crosses the wire, the key's redaction included, is replay-server.test.ts's: this is what lab:record does about it.
  it.for([
    ["the provider refuses a request (401)", { status: 401 }, /provider answered 401/],
    ["a model call AskDB can't make (an empty reply body)", { empty: true }, /SqlGenerationError/],
  ] as [string, { status: 401 } | { empty: true }, RegExp][])("stops when %s, keeping what it recorded before", async ([, behavior, reason], ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const cassettesDir = freshDir();

    const error = await withOverride({ "client-named-sato": behavior }, () =>
      record({ settings, dialects: ["sqlite"], only: ["agency-names", "client-named-sato"], target: "t", cassettesDir }).then(() => undefined, (e: unknown) => e),
    );

    expect(error).toBeInstanceOf(RecordAbort);
    expect((error as RecordAbort).message).toMatch(reason);
    expect((error as RecordAbort).outcome.written).toEqual([{ dialect: "sqlite", id: "agency-names" }]);
    expect(written(cassettesDir)).toEqual(["agency-names.json"]);
  });
});

describe("lab:record's report and CLI", () => {
  const miss = { dialect: "sqlite" as const, id: "agency-names", question: "q", reason: "wrong rows (got 1, expected 7)", reply: "```sql\nSELECT 1\n```" };
  const outcome = (o: Partial<RecordOutcome> = {}): RecordOutcome => ({ written: [], unchanged: [], misses: [], violations: [], ...o });

  it("exits 0 with misses, 1 with a violation or when the run stopped, and lists what a stopped run found", () => {
    const file = join(freshDir(), "record-misses.json");

    expect(writeRecordReport(outcome({ misses: [miss] }), "m", file).exitCode).toBe(0);
    expect(writeRecordReport(outcome({ violations: [{ ...miss, reason: "read-only violation: …" }] }), "m", file).exitCode).toBe(1);
    const stopped = writeRecordReport(outcome({ misses: [miss] }), "m", file, "lab record: the provider answered 429: quota");

    expect(stopped.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ model: "m", stopped: "lab record: the provider answered 429: quota", misses: [miss], violations: [] });
  });

  /** The CLI, spawned the way `pnpm lab:record` runs it, on paths that stop before a key is read. */
  function cli(args: string[], env: Record<string, string> = {}) {
    const run = spawnSync(join(LAB_ROOT, "node_modules", ".bin", "tsx"), [join(LAB_ROOT, "src", "record-cli.ts"), ...args], {
      cwd: LAB_ROOT,
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", ...env },
    });
    return { status: run.status, stderr: run.stderr };
  }

  it.each([
    ["a hand-written id", ["--only", "tenant-unfiltered"], {}, /hand-written test replies/],
    ["an unknown dialect", ["--db", "nope"], {}, /unknown dialect nope/],
    ["a CI run", ["--db", "sqlite", "--only", "agency-names"], { CI: "true" }, /never runs in CI/],
  ])("exits 2 for %s, before any key is read", (_what, args, env, message) => {
    const { status, stderr } = cli(args, env);

    expect(stderr).toMatch(message);
    expect(status).toBe(2);
  });
});

describe("live settings (lab:record and LAB_LIVE_MODEL=1)", () => {
  const envDir = mkdtempSync(join(tmpdir(), "lab-live-env-"));
  const keyFile = join(envDir, ".env.live");
  writeFileSync(keyFile, "OPENAI_API_KEY=sk-from-the-file-0123456789\n");
  const none = join(envDir, "missing.env");
  afterAll(() => rmSync(envDir, { recursive: true, force: true }));

  it("refuses in CI before reading any key", () => {
    expect(() => liveSettings("lab:record", { CI: "true", OPENAI_API_KEY: KEY }, [keyFile])).toThrow(/never runs in CI/);
    expect(() => liveSettings("live mode", { GITHUB_ACTIONS: "true", OPENAI_API_KEY: KEY }, [keyFile])).toThrow(/never runs in CI/);
  });

  it("fails with a message naming the variable and the file when there's no key, instead of falling back to replay", () => {
    expect(() => liveSettings("live mode", {}, [none])).toThrow(LiveModelError);
    expect(() => liveSettings("live mode", { OPENAI_API_KEY: "  " }, [none])).toThrow(/needs an OpenAI API key .*OPENAI_API_KEY .*missing\.env .*doesn't fall back to the replay model/);
  });

  it("reads the key from the first .env.live that exists without changing process.env, and a key in the environment wins", () => {
    const before = process.env.OPENAI_API_KEY;

    expect(liveSettings("lab:record", {}, [none, keyFile])).toEqual({ apiKey: "sk-from-the-file-0123456789", modelId: "gpt-4o-mini", baseURL: "https://api.openai.com/v1" });
    expect(liveSettings("lab:record", { OPENAI_API_KEY: KEY, LAB_LIVE_MODEL_ID: "gpt-4.1-mini" }, [keyFile])).toMatchObject({ apiKey: KEY, modelId: "gpt-4.1-mini" });
    expect(process.env.OPENAI_API_KEY).toBe(before);
  });
});

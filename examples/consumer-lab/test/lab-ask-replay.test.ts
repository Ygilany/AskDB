/**
 * `pnpm lab ask --db <dialect> "<catalog question>"`: the replay model, end to end, on
 * every engine and through both documented model paths.
 *
 * Protects: with no API key, each catalog question goes from the question through packed
 * AskDB (prompt, model call, extraction, validation) to rows executed on the fixture, on
 * all five dialects. The raw-model path (a `createOpenAI({ baseURL })` model passed to
 * `ask()`) and the adapter path (`createAskDb` with `@askdb/ai-openai`, configured by
 * `providerConfig.openai.baseUrl`) send the model the same prompt, and return the same
 * SQL, which is the cassette's. A question with no reply fails loudly, saying how to add
 * one.
 * Catches: a packed `@askdb/core` that rejects valid dialect syntax (backticks, brackets,
 * `TOP`, the quoted reserved-word table `order`), extraction that mangles a model reply,
 * config-driven model or baseUrl resolution in `@askdb/client`/`@askdb/ai-openai` that
 * drifts from the raw path, and a replay miss that passes silently. Both paths are given
 * the dialect explicitly (`ask({ dialect })`, `createAskDb({ dialect })`), so this checks
 * only that the client's documented `dialect` option wins over the artifact's recorded
 * provider (MariaDB's artifact records `mysql`, which changes the prompt). It doesn't
 * test the client inferring a dialect from the artifact.
 * Not covered elsewhere: the client and adapter unit tests mock the AI SDK; core's tests
 * use workspace source and never call a model over HTTP or run the SQL on an engine.
 * No production seam: both model paths are the documented ones; the replay server is
 * lab code speaking the public OpenAI protocol.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { cassetteSql, loadQuestions } from "../src/model/catalog.js";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const QUESTIONS = loadQuestions();

interface Run {
  status: number | null;
  out: string;
}

function labAsk(...args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--silent", "lab", "ask", ...args], { cwd: LAB });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

/** The SQL `lab ask` printed: from `sql:` up to `validation:`, continuation indent removed. */
function printedSql(out: string): string | undefined {
  const match = /^sql: {8}([\s\S]*?)\nvalidation:/m.exec(out);
  return match?.[1]!.replace(/\n {12}/g, "\n");
}

/** The digest `lab ask` printed of the prompt the replay server received. */
function printedPrompt(out: string): string | undefined {
  return /^prompt: {5}(.+)$/m.exec(out)?.[1];
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] lab-ask-replay", (dialect) => {
  const runs = new Map<string, { raw: Run; client: Run }>();

  beforeAll(async () => {
    await Promise.all(
      QUESTIONS.map(async (q) => {
        const [raw, client] = await Promise.all([
          labAsk("--db", dialect, q.text),
          labAsk("--db", dialect, "--via", "client", q.text),
        ]);
        runs.set(q.id, { raw, client });
      }),
    );
  });

  it.each(QUESTIONS.map((q) => [q.id]))("answers %s with validated SQL and rows", (id) => {
    const { raw } = runs.get(id)!;

    expect(raw.out).toContain("validation: ok");
    expect(raw.out).toMatch(/^\d+ rows?$/m);
    expect(raw.status).toBe(0);
  });

  it("returns every agency, unicode names intact", () => {
    const { raw } = runs.get("agency-names")!;

    expect(raw.out).toContain("東京オフィス");
    expect(raw.out).toContain("Agência São Paulo");
    expect(raw.out).toMatch(/^7 rows$/m);
  });

  it.each(QUESTIONS.map((q) => [q.id]))("sends the same prompt and returns the cassette's SQL for %s through both model paths", (id) => {
    const { raw, client } = runs.get(id)!;

    expect(client.status).toBe(0);
    expect(printedPrompt(raw.out)).toBeDefined();
    expect(printedPrompt(client.out)).toBe(printedPrompt(raw.out));
    expect(printedSql(raw.out)).toBe(cassetteSql(dialect, id));
    expect(printedSql(client.out)).toBe(printedSql(raw.out));
  });
});

describe("lab ask with no reply for the question", () => {
  it("fails, naming the catalog and the cassette to add, and runs nothing", async () => {
    const { status, out } = await labAsk("--db", "postgres", "Which agency has the most volunteers?");

    expect(out).toContain("contains none of the");
    expect(out).toContain("examples/consumer-lab/scenarios/questions.json");
    expect(out).toContain("examples/consumer-lab/cassettes/postgres/<id>.json");
    expect(out).not.toContain("validation:");
    expect(status).toBe(1);
  });
});

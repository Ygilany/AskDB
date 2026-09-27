/**
 * The lab's replay model server, as an OpenAI client sees it.
 *
 * Protects: the server speaks both OpenAI APIs `@ai-sdk/openai` uses (the Responses API
 * behind `openai(model)`, Chat Completions behind `openai.chat(model)`), answering from
 * the cassette of the question found in the prompt, for the dialect in the base URL. It
 * refuses a prompt with no catalog question, and a question with no cassette for that
 * dialect, with a message naming what to add; and it exposes every prompt it received at
 * `GET /__lab/requests`, for the suites that assert on prompts.
 * Catches: a reply shape the AI SDK can't parse (on the path `lab ask` doesn't take), a
 * replay miss answered with some default instead of an error, routing on the wrong
 * dialect, and prompts that go unrecorded.
 * Not covered elsewhere: `lab-ask-replay.test.ts` drives only the Responses API, and only
 * questions that have cassettes.
 * No production seam: the server is lab code; the client is the public AI SDK. AskDB isn't
 * involved, so the test uses its own catalog and cassettes in a temp directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startReplayServer, type RecordedRequest, type ReplayServer } from "../src/model/replay-server.js";

const dir = mkdtempSync(join(tmpdir(), "lab-replay-"));
const QUESTION = { id: "agency-count", text: "How many agencies are there?" };
const UNANSWERED = { id: "client-count", text: "How many clients are there?" };
const MYSQL_REPLY = "```sql\nSELECT COUNT(*) AS n FROM org.agency\n```";
const SQLITE_REPLY = "```sql\nSELECT COUNT(*) AS n FROM agency\n```";

let server: ReplayServer;

function model(dialect: string, api: "responses" | "chat") {
  const openai = createOpenAI({ baseURL: server.baseURL(dialect), apiKey: "unused" });
  return api === "responses" ? openai("gpt-4o-mini") : openai.chat("gpt-4o-mini");
}

function prompt(question: string) {
  return { system: "You write SQL.", prompt: `Question: ${question}\nAnswer with one SQL statement.`, maxRetries: 0 };
}

beforeAll(async () => {
  writeFileSync(join(dir, "questions.json"), JSON.stringify([QUESTION, UNANSWERED]));
  for (const [dialect, reply] of [["mysql", MYSQL_REPLY], ["sqlite", SQLITE_REPLY]]) {
    mkdirSync(join(dir, "cassettes", dialect!), { recursive: true });
    writeFileSync(join(dir, "cassettes", dialect!, `${QUESTION.id}.json`), JSON.stringify({ question: QUESTION.text, reply, source: "authored" }));
  }
  server = await startReplayServer({ questionsFile: join(dir, "questions.json"), cassettesDir: join(dir, "cassettes") });
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("replay server", () => {
  it.each([["responses"], ["chat"]] as const)("answers from the dialect's cassette over the %s API", async (api) => {
    const mysql = await generateText({ model: model("mysql", api), ...prompt(QUESTION.text) });
    const sqlite = await generateText({ model: model("sqlite", api), ...prompt(QUESTION.text) });

    expect(mysql.text).toBe(MYSQL_REPLY);
    expect(sqlite.text).toBe(SQLITE_REPLY);
  });

  it("refuses a catalog question with no cassette for the dialect, naming the file to add", async () => {
    const call = generateText({ model: model("mysql", "responses"), ...prompt(UNANSWERED.text) });

    await expect(call).rejects.toThrow(/no reply recorded for question client-count on mysql\. Add .*cassettes\/mysql\/client-count\.json .*"source": "authored"/);
  });

  it("refuses a prompt that contains no catalog question", async () => {
    const call = generateText({ model: model("postgres", "responses"), ...prompt("What is the meaning of life?") });

    await expect(call).rejects.toThrow(/contains none of the 2 catalog questions/);
  });

  it("serves every prompt it received, with the question it matched, at GET /__lab/requests", async () => {
    const before = ((await (await fetch(`${server.url}/__lab/requests`)).json()) as RecordedRequest[]).length;
    await generateText({ model: model("sqlite", "chat"), ...prompt(QUESTION.text) });

    const requests = (await (await fetch(`${server.url}/__lab/requests`)).json()) as RecordedRequest[];
    const last = requests.at(-1)!;

    expect(requests).toHaveLength(before + 1);
    expect(last).toMatchObject({ dialect: "sqlite", endpoint: "chat/completions", model: "gpt-4o-mini", questionId: QUESTION.id, error: null });
    expect(last.prompt).toContain("You write SQL.");
    expect(last.prompt).toContain(`Question: ${QUESTION.text}`);
  });
});

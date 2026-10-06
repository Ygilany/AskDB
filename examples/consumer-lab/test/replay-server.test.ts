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
 *
 * Record mode (`pnpm lab:record`, #247), the "record mode" describe below:
 * Protects: with an upstream, the server forwards each catalog question's request to the real
 * provider and hands back its reply untouched, and the provider key stays in the server: the
 * upstream gets the server's key, never the client's placeholder, and neither the request log
 * (`GET /__lab/requests`) nor an error the client sees holds the key, even when the provider
 * echoes it. A prompt with no catalog question is never forwarded, so it costs nothing.
 * Catches: a proxy that forwards the client's `Authorization` header, records headers or the
 * key, passes a provider error naming the key through to the terminal, or forwards stray
 * prompts.
 * Not covered elsewhere: `record.test.ts` drives `lab:record` through this server but checks
 * the cassettes it writes, not what crossed the wire. The upstream here is a local stand-in, so
 * no key and no network are needed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
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

  it("names pnpm lab:record in a missing-cassette message for the lab's catalog, and not for another catalog", async () => {
    const empty = mkdtempSync(join(tmpdir(), "lab-replay-empty-"));
    const labCatalog = await startReplayServer({ cassettesDir: empty });
    try {
      const openai = createOpenAI({ baseURL: labCatalog.baseURL("mysql"), apiKey: "unused" });
      const call = generateText({ model: openai("gpt-4o-mini"), ...prompt("List every agency's id and name, ordered by id."), maxRetries: 0 });
      await expect(call).rejects.toThrow(/or record one from a live model: pnpm lab:record --db mysql --only agency-names\./);
    } finally {
      await labCatalog.close();
      rmSync(empty, { recursive: true, force: true });
    }

    const other = await generateText({ model: model("mysql", "responses"), ...prompt(UNANSWERED.text) }).then(() => "", (e: Error) => e.message);
    expect(other).toMatch(/no reply recorded for question client-count/);
    expect(other).not.toMatch(/lab:record/);
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

describe("record mode", () => {
  /** The key the server holds; the stand-in provider echoes it back in its 401, as a careless one might. */
  const KEY = "sk-lab-test-0123456789abcdefghij";
  const RECORDED_REPLY = "```sql\nSELECT COUNT(*) AS agencies FROM org.agency\n```";
  const received: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  let upstreamStatus = 200;
  let upstream: ReturnType<typeof createServer>;
  let recorder: ReplayServer;

  beforeAll(async () => {
    upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      received.push({ path: req.url ?? "", headers: req.headers, body });
      res.writeHead(upstreamStatus, { "content-type": "application/json" });
      if (upstreamStatus !== 200) {
        res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.`, type: "invalid_request_error", code: "invalid_api_key" } }));
      } else if (req.url?.endsWith("/chat/completions")) {
        res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "gpt-4o-mini-2024-07-18", choices: [{ index: 0, message: { role: "assistant", content: RECORDED_REPLY }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      } else {
        res.end(JSON.stringify({ id: "r1", object: "response", created_at: 1, model: "gpt-4o-mini-2024-07-18", status: "completed", output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: RECORDED_REPLY, annotations: [] }] }], incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const baseURL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
    recorder = await startReplayServer({ questionsFile: join(dir, "questions.json"), cassettesDir: join(dir, "cassettes"), upstream: { baseURL, apiKey: KEY } });
  });

  afterAll(async () => {
    await recorder?.close();
    upstream?.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  function recording(api: "responses" | "chat") {
    const openai = createOpenAI({ baseURL: recorder.baseURL("mysql"), apiKey: "lab-replay-no-key" });
    return api === "responses" ? openai("gpt-4o-mini") : openai.chat("gpt-4o-mini");
  }

  it.each([["responses"], ["chat"]] as const)("forwards a catalog question over the %s API with the server's key and returns the provider's reply", async (api) => {
    upstreamStatus = 200;
    received.length = 0;

    // UNANSWERED has no cassette: in record mode that doesn't matter, the provider answers.
    const result = await generateText({ model: recording(api), ...prompt(UNANSWERED.text) });

    expect(result.text).toBe(RECORDED_REPLY);
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe(api === "responses" ? "/v1/responses" : "/v1/chat/completions");
    expect(received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(received[0]!.body.model).toBe("gpt-4o-mini");
    const log = (await (await fetch(`${recorder.url}/__lab/requests`)).json()) as RecordedRequest[];
    expect(log.at(-1)).toMatchObject({ questionId: UNANSWERED.id, reply: RECORDED_REPLY, upstreamModel: "gpt-4o-mini-2024-07-18", error: null });
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("keeps the key out of a provider error, in what the client sees and in the request log", async () => {
    upstreamStatus = 401;

    const call = generateText({ model: recording("responses"), ...prompt(QUESTION.text), maxRetries: 0 });

    const error = await call.then(() => undefined, (e: unknown) => e);
    expect(String((error as Error)?.message)).toMatch(/Incorrect API key provided: \[redacted\]/);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(KEY);
    const log = await (await fetch(`${recorder.url}/__lab/requests`)).text();
    expect(log).toContain("[redacted]");
    expect(log).not.toContain(KEY);
  });

  it("never forwards a prompt that holds no catalog question", async () => {
    upstreamStatus = 200;
    received.length = 0;

    const call = generateText({ model: recording("responses"), ...prompt("What is the meaning of life?"), maxRetries: 0 });

    await expect(call).rejects.toThrow(/contains none of the 2 catalog questions/);
    expect(received).toHaveLength(0);
  });
});

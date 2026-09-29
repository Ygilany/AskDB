/**
 * The lab's model: a small OpenAI-compatible HTTP server that answers from cassettes,
 * so the lab runs with no API key. Any OpenAI client works against it; the lab points
 * `createOpenAI({ baseURL })` (the raw-model path) and `@askdb/ai-openai` configured
 * with `providerConfig.openai.baseUrl` (the adapter path) at it.
 *
 *   POST /<dialect>/v1/responses          the Responses API, which `openai(model)` uses (non-streaming)
 *   POST /<dialect>/v1/chat/completions   the Chat Completions API, which `openai.chat(model)` uses
 *   GET  /__lab/requests                  every request received, with its prompt text
 *
 * The dialect comes from the base URL (`http://127.0.0.1:<port>/<dialect>/v1`). The
 * question is found by looking for each catalog question's text in the prompt. With no
 * matching question, or no cassette for the question on that dialect, the request fails
 * with a message saying what's missing and how to add it. There is no default reply.
 *
 * Node built-ins only: the replay server never imports AskDB.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CASSETTES_DIR, QUESTIONS_FILE, cassettePath, displayPath, loadQuestions, readCassette, type Question } from "./catalog.js";

export const REPLAY_DIALECTS = ["postgres", "mysql", "mariadb", "sqlserver", "sqlite"] as const;

export interface ReplayServerOptions {
  /** Default 0: any free port. */
  port?: number;
  questionsFile?: string;
  cassettesDir?: string;
}

export interface RecordedRequest {
  dialect: string;
  endpoint: "responses" | "chat/completions";
  model: string | null;
  /** Every text part of the request (instructions, system and user messages), joined with blank lines. */
  prompt: string;
  /** The catalog question found in the prompt, if any. */
  questionId: string | null;
  /** The reply sent, from the cassette. */
  reply: string | null;
  /** Set when the request was refused; the same message the client received. */
  error: string | null;
}

export interface ReplayServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** The OpenAI base URL for a dialect: `http://127.0.0.1:<port>/<dialect>/v1`. */
  baseURL(dialect: string): string;
  /** What `GET /__lab/requests` returns, for an in-process caller. */
  requests(): readonly RecordedRequest[];
  close(): Promise<void>;
}

class ReplayMiss extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Collect every string under the request's prompt-bearing fields, in order. */
function promptText(body: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) if (key === "content" || key === "text" || typeof v === "object") walk(v);
    }
  };
  walk(body.instructions);
  walk(body.input);
  walk(body.messages);
  return parts.join("\n\n");
}

function matchQuestion(prompt: string, questions: Question[], dialect: string, questionsFile: string): Question {
  const found = questions.filter((q) => prompt.includes(q.text));
  if (found.length === 1) return found[0]!;
  if (found.length > 1) {
    throw new ReplayMiss(409, `lab replay: the prompt contains more than one catalog question (${found.map((q) => q.id).join(", ")}); make their texts distinct in ${displayPath(questionsFile)}.`);
  }
  throw new ReplayMiss(
    404,
    `lab replay: no reply for this prompt on ${dialect}: it contains none of the ${questions.length} catalog questions. ` +
      `Add the question to ${displayPath(questionsFile)} ({ "id", "text" }), then its reply at ${displayPath(cassettePath(dialect, "<id>"))} ` +
      `({ "question", "reply": "\`\`\`sql …\`\`\`", "source": "authored" }).`,
  );
}

function reply(dialect: string, prompt: string, opts: Required<Omit<ReplayServerOptions, "port">>): { question: Question; text: string } {
  const question = matchQuestion(prompt, loadQuestions(opts.questionsFile), dialect, opts.questionsFile);
  const cassette = readCassette(dialect, question, opts.cassettesDir);
  if (!cassette) {
    const path = displayPath(cassettePath(dialect, question.id, opts.cassettesDir));
    throw new ReplayMiss(
      404,
      `lab replay: no reply recorded for question ${question.id} on ${dialect}. Add ${path} with ` +
        `{ "question": ${JSON.stringify(question.text)}, "reply": "\`\`\`sql\\n<${dialect} SQL>\\n\`\`\`", "source": "authored" }.`,
    );
  }
  return { question, text: cassette.reply };
}

function responsesBody(model: string, text: string, n: number) {
  return {
    id: `resp_lab_${n}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: [
      {
        type: "message",
        id: `msg_lab_${n}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    incomplete_details: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function chatBody(model: string, text: string, n: number) {
  return {
    id: `chatcmpl_lab_${n}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** An OpenAI-shaped error, so the client's error message is ours. */
function sendError(res: ServerResponse, status: number, message: string): void {
  send(res, status, { error: { message, type: "lab_replay_miss", param: null, code: "lab_replay_miss" } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

const ROUTE = /^\/([a-z]+)\/v1\/(responses|chat\/completions)$/;

export async function startReplayServer(options: ReplayServerOptions = {}): Promise<ReplayServer> {
  const opts = { questionsFile: options.questionsFile ?? QUESTIONS_FILE, cassettesDir: options.cassettesDir ?? CASSETTES_DIR };
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    if (req.method === "GET" && path === "/__lab/requests") return send(res, 200, requests);

    const route = req.method === "POST" ? ROUTE.exec(path) : null;
    if (!route) return sendError(res, 404, `lab replay: no route for ${req.method} ${path}; POST /<dialect>/v1/responses or /<dialect>/v1/chat/completions.`);
    const [, dialect, endpoint] = route as unknown as [string, string, RecordedRequest["endpoint"]];

    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      return sendError(res, 400, "lab replay: the request body isn't JSON.");
    }
    const prompt = promptText(body);
    const model = typeof body.model === "string" ? body.model : null;
    const record: RecordedRequest = { dialect, endpoint, model, prompt, questionId: null, reply: null, error: null };
    requests.push(record);

    try {
      if (!(REPLAY_DIALECTS as readonly string[]).includes(dialect)) {
        throw new ReplayMiss(404, `lab replay: unknown dialect "${dialect}" in the base URL; use one of ${REPLAY_DIALECTS.join(", ")}.`);
      }
      if (body.stream === true) throw new ReplayMiss(400, "lab replay: streaming isn't supported; the lab's model calls are non-streaming.");
      const { question, text } = reply(dialect, prompt, opts);
      record.questionId = question.id;
      record.reply = text;
      const n = requests.length;
      send(res, 200, endpoint === "responses" ? responsesBody(model ?? "lab-replay", text, n) : chatBody(model ?? "lab-replay", text, n));
    } catch (error) {
      const status = error instanceof ReplayMiss ? error.status : 500;
      record.error = error instanceof Error ? error.message : String(error);
      sendError(res, status, record.error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    baseURL: (dialect) => `${url}/${dialect}/v1`,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Clients keep connections alive; don't wait for them to time out.
        server.closeAllConnections();
      }),
  };
}

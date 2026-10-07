/**
 * A stand-in for OpenAI that replaces `globalThis.fetch` for `https://api.openai.com/`, so the
 * live-model tests run the real live code paths (`lab ask --model live`, `lab ui`'s live option,
 * both model paths) with a fake key, and nothing reaches the network. Every other URL (the
 * replay server, the fixture) goes to the real `fetch`.
 *
 * In-process, a test calls `installOpenAiStub`. In a process a test spawns (`lab ask`, `lab ui`
 * and its engine processes), `NODE_OPTIONS=--import <this file>` loads it, configured from
 * `LAB_STUB_REPLIES` (a JSON file: question text → reply, or `{ "status": 401 }` for a refusal
 * that echoes the key, as OpenAI's does) and `LAB_STUB_LOG` (a file it appends one JSON line to
 * per request). `stubOpenAiEnv` in `stub-openai.ts` writes both.
 *
 * A request is answered with the reply for the first catalog question its body holds, in the
 * Responses API's shape or Chat Completions' by path. The log records the question, the model
 * asked for, and whether the request carried `LAB_STUB_KEY`, never the header itself: a key
 * that isn't the fake one is refused with a 401 and logged as such, so a test that picks up a
 * real key fails without writing it anywhere.
 *
 * Node built-ins only, and plain JavaScript, so it loads before any TypeScript loader.
 */
import { appendFileSync, readFileSync } from "node:fs";

const OPENAI = "https://api.openai.com/";

/**
 * Replace `globalThis.fetch` for OpenAI's API. `replies` maps a question's text to the reply
 * text, or to `{ status: 401 }`. Returns the requests seen, live, and a function that restores
 * the real `fetch`.
 */
export function installOpenAiStub({ replies, key, onRequest = () => {} }) {
  const real = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(OPENAI)) return real(input, init);
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.text() : "";
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const question = Object.keys(replies).find((q) => body.includes(JSON.stringify(q).slice(1, -1))) ?? null;
    let model = null;
    try {
      model = JSON.parse(body).model ?? null;
    } catch {}
    const request = { path: new URL(url).pathname, question, model, authorized: headers.get("authorization") === `Bearer ${key}` };
    requests.push(request);
    onRequest(request);
    const reply = question === null ? "```sql\nSELECT 1\n```" : replies[question];
    if (!request.authorized || typeof reply === "object") {
      // OpenAI echoes the key it refused; a wrong one is never echoed here.
      const echoed = request.authorized ? key : "sk-not-the-stub-key";
      return Response.json({ error: { message: `Incorrect API key provided: ${echoed}.`, code: "invalid_api_key" } }, { status: 401 });
    }
    if (request.path.endsWith("/chat/completions")) {
      return Response.json({
        id: "c1", object: "chat.completion", created: 1, model: "gpt-4o-mini-2024-07-18",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return Response.json({
      id: "r1", object: "response", created_at: 1, model: "gpt-4o-mini-2024-07-18", status: "completed", incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: reply, annotations: [] }] }],
    });
  };
  return { requests, restore: () => void (globalThis.fetch = real) };
}

// Preloaded into a spawned process: configure from the environment.
if (process.env.LAB_STUB_REPLIES) {
  const log = process.env.LAB_STUB_LOG;
  installOpenAiStub({
    replies: JSON.parse(readFileSync(process.env.LAB_STUB_REPLIES, "utf8")),
    key: process.env.LAB_STUB_KEY,
    onRequest: (request) => log && appendFileSync(log, `${JSON.stringify(request)}\n`),
  });
}

/**
 * The OpenAI stand-in (`stub-openai-fetch.mjs`) for a process a test spawns: the environment
 * that preloads it with these replies and a fake key, and the requests it logged.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The fake key the stand-in accepts. Shaped like a real one, so `redact` must catch it. */
export const STUB_KEY = "sk-lab-stub-0123456789abcdefghij";
const PRELOAD = pathToFileURL(join(import.meta.dirname, "stub-openai-fetch.mjs")).href;

export interface StubRequest {
  path: string;
  question: string | null;
  /** Whether it carried {@link STUB_KEY}. */
  authorized: boolean;
}

export type StubReplies = Record<string, string | { status: 401 }>;

export interface OpenAiStubEnv {
  /** Add to the spawned process's environment: the stand-in, its replies, and the fake key as `OPENAI_API_KEY`. */
  env: Record<string, string>;
  /** The requests the stand-in has answered so far, in every process that loaded it. */
  requests(): StubRequest[];
  dispose(): void;
}

export function stubOpenAiEnv(replies: StubReplies): OpenAiStubEnv {
  const dir = mkdtempSync(join(tmpdir(), "lab-openai-stub-"));
  const repliesFile = join(dir, "replies.json");
  const log = join(dir, "requests.ndjson");
  writeFileSync(repliesFile, JSON.stringify(replies));
  return {
    env: {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
      LAB_STUB_REPLIES: repliesFile,
      LAB_STUB_LOG: log,
      LAB_STUB_KEY: STUB_KEY,
      OPENAI_API_KEY: STUB_KEY,
      CI: "",
      GITHUB_ACTIONS: "",
    },
    requests: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StubRequest) : []),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * The live model's settings, for `pnpm lab:record` and `LAB_LIVE_MODEL=1 pnpm lab:matrix`
 * (#247): the OpenAI key, the model id, and the refusals that keep both modes out of CI and
 * off the replay model.
 *
 * The key comes from the environment or from a `.env.live` file (gitignored), in the lab
 * (`examples/consumer-lab/.env.live`) or else at the repo root, which only these modes read: AskDB's config loads `.env`, so a key kept there would reach
 * every replay run too. A variable already set in the environment wins over the file, and
 * reading the file doesn't change `process.env`: `lab:record` keeps the key in its proxy, and
 * only the live suite's own worker puts it in `process.env`, for the adapter path's config. The
 * key is never printed; callers send it to the provider only and scrub it from what they write.
 *
 * Node built-ins only: this never imports AskDB.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { LAB_ROOT } from "../paths.js";

/** Where the key file may be, in the order they're tried: the first that exists is read. */
export const LIVE_ENV_FILES = [join(LAB_ROOT, ".env.live"), join(LAB_ROOT, "..", "..", ".env.live")];
/** AskDB's default OpenAI language model, on every release the lab targets. */
export const DEFAULT_LIVE_MODEL_ID = "gpt-4o-mini";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export type LiveMode = "lab:record" | "live mode";

export interface LiveSettings {
  apiKey: string;
  /** `LAB_LIVE_MODEL_ID`, or AskDB's OpenAI default. */
  modelId: string;
  baseURL: string;
}

/** A refusal: no key, or a CI run. Its message is meant for the terminal as is. */
export class LiveModelError extends Error {
  override name = "LiveModelError";
}

/**
 * The live settings, or a {@link LiveModelError} saying why there are none. Refuses in CI
 * before reading any key. Never falls back to the replay model.
 */
export function liveSettings(mode: LiveMode, env: NodeJS.ProcessEnv = process.env, envFiles: readonly string[] = LIVE_ENV_FILES): LiveSettings {
  if (env.CI || env.GITHUB_ACTIONS) {
    throw new LiveModelError(`${mode} calls a real model and never runs in CI (CI is set). CI uses the replay model and needs no key.`);
  }
  const envFile = envFiles.find((f) => existsSync(f));
  const file = envFile ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const vars = { ...file, ...env };
  const apiKey = vars.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new LiveModelError(
      `${mode} needs an OpenAI API key and found none: set OPENAI_API_KEY in your shell or in ${envFile ?? envFiles.join(" or ")} ` +
        "(gitignored; never commit it). It doesn't fall back to the replay model.",
    );
  }
  return { apiKey, modelId: vars.LAB_LIVE_MODEL_ID?.trim() || DEFAULT_LIVE_MODEL_ID, baseURL: OPENAI_BASE_URL };
}

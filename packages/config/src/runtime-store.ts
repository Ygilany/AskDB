import type { AskDbConfig } from "./types.js";

export type AskDbRuntimeStore = {
  readonly structured: AskDbConfig;
  /** Canonical string map from {@link flattenAskDbConfig} (same keys as former merged `process.env`). */
  readonly flat: Readonly<Record<string, string>>;
};

let stored: AskDbRuntimeStore | undefined;

export function setAskDbRuntime(data: AskDbRuntimeStore): void {
  stored = data;
}

export function clearAskDbRuntime(): void {
  stored = undefined;
}

export function getAskDbRuntimeStore(): AskDbRuntimeStore {
  if (!stored) {
    throw new Error(
      "AskDB runtime is not initialized. Call bootstrapAskDbEnv() (or bootstrapAskDbRuntime()) from @askdb/config after startup, " +
        "typically with the project cwd, and ensure askdb.config.* exists.",
    );
  }
  return stored;
}

/** Build an env-shaped map for `@askdb/core` from the flattened runtime snapshot (not `process.env`). */
export function flatToAiEnv(flat: Readonly<Record<string, string>>): Record<string, string | undefined> {
  return { ...flat };
}

/**
 * Merge AskDB flat keys into a base env map (e.g. for spawning child processes).
 * Does not read `process.env` itself.
 */
export function mergeAskDbFlatIntoEnvMap(
  base: NodeJS.ProcessEnv,
  flat: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  for (const [k, v] of Object.entries(flat)) {
    if (v.trim() !== "") {
      out[k] = v;
    }
  }
  return out;
}

/** @internal Tests only — replaces the runtime store without loading from disk. */
export function setAskDbRuntimeForTests(data: AskDbRuntimeStore): void {
  stored = data;
}

/** @internal Tests only. */
export function resetAskDbRuntimeForTests(): void {
  stored = undefined;
}

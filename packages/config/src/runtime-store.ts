import { defineConfig } from "./projection.js";
import type { AskDbConfig } from "./types.js";

export type AskDbRuntimeStore = {
  readonly structured: AskDbConfig;
  /**
   * Canonical string map, the projection's `entries` from {@link defineConfig}. Written for
   * copies of `@askdb/config` that still read it; this copy resolves every value from `structured`
   * and never reads it back.
   */
  readonly flat: Readonly<Record<string, string>>;
};

/**
 * The snapshot lives on `globalThis` under a registered symbol, not in a module variable, so every
 * copy of `@askdb/config` in a process shares it: a host that bootstraps with its own version is
 * seen by an app (such as `@askdb/http-api`) that depends on another. Keep `AskDbRuntimeStore`
 * readable by older copies; a change they can't read needs a new key.
 */
const RUNTIME_STORE_KEY: unique symbol = Symbol.for("askdb.runtimeStore");

const runtimeHolder = globalThis as typeof globalThis & { [RUNTIME_STORE_KEY]?: AskDbRuntimeStore };

export function setAskDbRuntime(data: AskDbRuntimeStore): void {
  runtimeHolder[RUNTIME_STORE_KEY] = data;
}

/**
 * `true` once `bootstrapAskDbEnv()` (or another installer) has set the runtime snapshot.
 * A host-facing factory can use it to bootstrap only when its host hasn't already done so.
 */
export function isAskDbRuntimeInitialized(): boolean {
  return runtimeHolder[RUNTIME_STORE_KEY] !== undefined;
}

export function getAskDbRuntimeStore(): AskDbRuntimeStore {
  const stored = runtimeHolder[RUNTIME_STORE_KEY];
  if (!stored) {
    throw new Error(
      "AskDB runtime is not initialized. Call bootstrapAskDbEnv() (or bootstrapAskDbRuntime()) from @askdb/config after startup, " +
        "typically with the project cwd, and ensure askdb.config.* exists.",
    );
  }
  return stored;
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

/**
 * @internal Tests only — installs `config` as `bootstrapAskDbEnv()` installs a loaded file,
 * without reading the disk. Throws the same `askdb.config: …` errors as `defineConfig`.
 */
export function setAskDbRuntimeForTests(config: AskDbConfig): void {
  const { config: structured, entries } = defineConfig(config);
  setAskDbRuntime({ structured, flat: { ...entries } });
}

/** @internal Tests only. */
export function resetAskDbRuntimeForTests(): void {
  delete runtimeHolder[RUNTIME_STORE_KEY];
}

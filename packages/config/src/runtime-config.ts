import type { AskDbConfig } from "./types.js";
import { resolveAskDbConfig, type AskDbConfigResolution } from "./resolve.js";
import type { AskDbRuntimeConfig } from "./runtime-types.js";
import { getAskDbRuntimeStore } from "./runtime-store.js";

/** Resolution is pure, so it runs once per installed config object. */
const resolutionByConfig = new WeakMap<object, AskDbConfigResolution>();

function resolutionFor(structured: Readonly<AskDbConfig>): AskDbConfigResolution {
  let resolution = resolutionByConfig.get(structured);
  if (!resolution) {
    resolution = resolveAskDbConfig(structured);
    resolutionByConfig.set(structured, resolution);
  }
  return resolution;
}

/**
 * Returns typed runtime configuration from the snapshot installed by {@link bootstrapAskDbEnv}.
 *
 * Every value is resolved from the snapshot's structured config. The snapshot's own flat map is
 * never read back: another copy of `@askdb/config` may have installed it (ADR 0005), so `flat` is
 * this copy's projection of the same structured config.
 */
export function getAskDbRuntimeConfig(): AskDbRuntimeConfig {
  const { structured } = getAskDbRuntimeStore();
  const { resolved, flat, deprecations } = resolutionFor(structured);
  return {
    structured,
    flat,
    ...resolved,
    deprecations,
  };
}

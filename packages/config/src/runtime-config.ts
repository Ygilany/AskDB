import type { AskDbConfig } from "./types.js";
import { flattenResolvedAskDbConfig } from "./flatten.js";
import { resolveAskDbConfig, type ResolvedAskDbConfig } from "./resolve.js";
import type { AskDbRuntimeConfig } from "./runtime-types.js";
import { getAskDbRuntimeStore } from "./runtime-store.js";

type Resolution = { resolved: ResolvedAskDbConfig; flat: Readonly<Record<string, string>>; deprecations: string[] };

/** Resolution is pure, so it runs once per installed config object. */
const resolutionByConfig = new WeakMap<object, Resolution>();

function resolutionFor(structured: Readonly<AskDbConfig>): Resolution {
  let resolution = resolutionByConfig.get(structured);
  if (!resolution) {
    const config = structured as AskDbConfig;
    const { resolved, deprecations } = resolveAskDbConfig(config);
    resolution = { resolved, flat: flattenResolvedAskDbConfig(resolved, config), deprecations };
    resolutionByConfig.set(structured, resolution);
  }
  return resolution;
}

/**
 * Returns typed runtime configuration from the snapshot installed by {@link bootstrapAskDbEnv}.
 *
 * Every value is resolved from the snapshot's structured config. The snapshot's own flat map is
 * never read back: another copy of `@askdb/config` may have installed it (ADR 0005), so `flat`
 * and `ai.aiEnv` are this copy's projection of the same structured config.
 */
export function getAskDbRuntimeConfig(): AskDbRuntimeConfig {
  const { structured } = getAskDbRuntimeStore();
  const { resolved, flat, deprecations } = resolutionFor(structured);
  return {
    structured,
    flat,
    ...resolved,
    ai: { aiEnv: { ...flat }, ...resolved.ai },
    deprecations,
  };
}

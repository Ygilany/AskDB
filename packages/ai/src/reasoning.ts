/**
 * Provider-portable reasoning/latency effort for AskDB model calls.
 *
 * `undefined` means "use the provider/model's own default" — no
 * `providerOptions` are computed or sent, which preserves AskDB's current
 * behavior for callers that never opt in.
 *
 * Each `@askdb/ai-*` adapter maps this portable value to its provider's native
 * knob (OpenAI `reasoningEffort`, Google `thinkingConfig`, Anthropic extended
 * thinking, …) via {@link AiProviderAdapter.resolveProviderOptions}, and skips
 * models that don't support reasoning tuning.
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** AskDB model-call purposes with independently tunable reasoning effort. */
export type AiCallPurpose = "nlToSql" | "enrichment";

export type ReasoningSettings = {
  /** Portable reasoning/latency effort. `undefined` preserves current (no `providerOptions`) behavior. */
  reasoningEffort?: ReasoningEffort;
};

const CALL_PURPOSE_ENV_VAR: Record<AiCallPurpose, string> = {
  nlToSql: "ASKDB_AI_REASONING_EFFORT_NL_TO_SQL",
  enrichment: "ASKDB_AI_REASONING_EFFORT_ENRICHMENT",
};

/**
 * Resolves the effective reasoning effort for a call site.
 *
 * Precedence: explicit `override` (programmatic per-call argument) > the
 * call-site-scoped env var (e.g. `ASKDB_AI_REASONING_EFFORT_NL_TO_SQL`) >
 * the global `ASKDB_AI_REASONING_EFFORT` > `undefined` (provider/model
 * default — nothing configured).
 *
 * `env` is typically `getAskDbRuntimeConfig().ai.aiEnv` from `@askdb/config`,
 * already populated by `flattenAskDbConfig` from `askdb.config.*`'s
 * `ai.reasoning` block.
 */
export function resolveReasoningEffort(
  env: Record<string, string | undefined>,
  purpose?: AiCallPurpose,
  override?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (override) return override;
  if (purpose) {
    const scoped = env[CALL_PURPOSE_ENV_VAR[purpose]]?.trim();
    if (scoped && isReasoningEffort(scoped)) return scoped;
  }
  const global = env.ASKDB_AI_REASONING_EFFORT?.trim();
  if (global && isReasoningEffort(global)) return global;
  return undefined;
}

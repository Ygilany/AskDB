/**
 * Provider-portable reasoning/latency effort for AskDB model calls.
 *
 * `undefined` means "use the provider/model's own default": no
 * `providerOptions` are computed or sent.
 *
 * Each provider adapter (built in or custom) maps this portable value to its provider's native
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
  /** Portable reasoning/latency effort. `undefined` sends no `providerOptions` (provider/model default). */
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

/** `ai.language.reasoning`: a default effort, and one per call purpose that overrides it. */
export type AiReasoningSection = {
  effort?: ReasoningEffort;
  nlToSql?: ReasoningEffort;
  enrichment?: ReasoningEffort;
};

/**
 * Resolves the effective reasoning effort for a call site from a typed section, such as
 * `getAskDbRuntimeConfig().ai.language.reasoning` from `@askdb/config`: the section counterpart of
 * {@link resolveReasoningEffort}.
 *
 * Precedence: explicit `override` > the call purpose's own effort (`reasoning.nlToSql` or
 * `reasoning.enrichment`) > `reasoning.effort` > `undefined` (provider/model default). A value
 * that isn't a {@link ReasoningEffort} is skipped.
 */
export function resolveReasoningEffortFromSection(
  reasoning: AiReasoningSection | undefined,
  usage: AiCallPurpose,
  override?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (override) return override;
  for (const value of [reasoning?.[usage], reasoning?.effort]) {
    if (value !== undefined && isReasoningEffort(value)) return value;
  }
  return undefined;
}

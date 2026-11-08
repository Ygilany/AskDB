import { generateText, jsonSchema, Output, type JSONSchema7 } from "ai";
import { maskSqlLiterals, type AskDbLanguageModel, type AskDialectInput, type DialectSpec } from "@askdb/core";
import { fallbackChart } from "./fallback.js";
import { buildChartUserPrompt, CHART_SYSTEM_PROMPT } from "./prompt.js";
import type { ChartFallbackReason, ChartPlan, ChartSpec, ChartSpecIssue, ChartType, ClassifiedResult } from "./types.js";
import { validateChartSpec } from "./validate.js";

const CHART_TYPES: readonly ChartType[] = ["metric", "line", "area", "bar", "horizontal-bar", "pie"];
const DEFAULT_TIMEOUT_MS = 15_000;

export type PlanChartOptions = {
  /** The user's question, for intent. */
  question: string;
  /** The query the host ran. Its literals are replaced with `?` before the model sees it. */
  sql: string;
  /** The result, classified in the host process by {@link classifyResult}. Only its `shape` reaches the model. */
  result: ClassifiedResult;
  /** Any AI SDK `LanguageModel`, built by the host or by `@askdb/ai`'s registry. */
  model: AskDbLanguageModel;
  /**
   * The SQL dialect, given as `ask()` takes it: a built-in id, a `DialectSpec` or a custom
   * dialect. It decides how literals are found. An id that isn't built in, a custom dialect, or
   * none reads the SQL every engine's way, which masks more.
   */
  dialect?: AskDialectInput;
  /** Forwarded to the model call's `providerOptions`, as in `ask()`. */
  providerOptions?: Record<string, unknown>;
  /** Cancels the model call; the plan then comes from the fallback. */
  abortSignal?: AbortSignal;
  /** How long to wait for the model before falling back. Default 15000. */
  timeoutMs?: number;
};

const specSchema: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["type", "category", "series", "title", "description"],
  properties: {
    type: { type: "string", enum: [...CHART_TYPES] },
    category: { type: ["string", "null"] },
    series: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    description: { type: "string" },
  },
};

const planSchema: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["primary", "alternate"],
  properties: { primary: specSchema, alternate: { anyOf: [specSchema, { type: "null" }] } },
};

type ModelPlan = { primary: unknown; alternate: unknown };

/** The model's spec as a {@link ChartSpec}, or undefined when it isn't one. */
function readSpec(value: unknown): ChartSpec | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!CHART_TYPES.includes(v.type as ChartType)) return undefined;
  if (!Array.isArray(v.series) || !v.series.every((s) => typeof s === "string")) return undefined;
  if (typeof v.title !== "string" || typeof v.description !== "string") return undefined;
  if (v.category !== undefined && v.category !== null && typeof v.category !== "string") return undefined;
  return {
    type: v.type as ChartType,
    ...(typeof v.category === "string" ? { category: v.category } : {}),
    series: v.series as string[],
    title: v.title,
    description: v.description,
  };
}

function readingDialect(dialect: AskDialectInput | undefined): Pick<DialectSpec, "id" | "backslashEscapes"> | undefined {
  if (dialect === undefined) return undefined;
  if (typeof dialect === "string") return { id: dialect };
  return "generate" in dialect ? undefined : dialect;
}

/**
 * Plans a chart for a query result without sending a row to the model. The model gets the
 * question, the SQL with every literal replaced by `?` (no SQL at all if it can't be read
 * safely), and the result's shape: column names and kinds, the row count and the truncated
 * flag. It returns a declarative spec, which is checked against the result; an invalid spec,
 * an error, a timeout or an abort gives the deterministic fallback instead. It never rejects
 * because of the model. The host draws the chart from its own rows.
 *
 * @experimental Part of `@askdb/client/charts`, outside AskDB's 1.0 stability promise: a minor release may change it.
 */
export async function planChart(options: PlanChartOptions): Promise<ChartPlan> {
  const started = performance.now();
  const { question, result } = options;
  const finish = (plan: Omit<ChartPlan, "latencyMs">): ChartPlan => ({ ...plan, latencyMs: Math.round(performance.now() - started) });
  const fallback = (fallbackReason: ChartFallbackReason, issues?: ChartSpecIssue[]) =>
    finish({ primary: fallbackChart(question, result), source: "fallback", fallbackReason, ...(issues ? { issues } : {}) });

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, timeout]) : timeout;
  let output: ModelPlan;
  try {
    // Raced against the signal too, so a model that ignores it still can't hold the plan up.
    const aborted = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const call = generateText({
      model: options.model,
      system: CHART_SYSTEM_PROMPT,
      prompt: buildChartUserPrompt(question, maskSqlLiterals(options.sql, readingDialect(options.dialect)), result.shape),
      output: Output.object({ schema: jsonSchema<ModelPlan>(planSchema) }),
      abortSignal: signal,
      ...(options.providerOptions ? { providerOptions: options.providerOptions as never } : {}),
    });
    // Whichever loses the race settles later; that settlement is expected, not an error.
    call.catch(() => {});
    aborted.catch(() => {});
    output = (await Promise.race([call, aborted])).output;
  } catch (error) {
    if (options.abortSignal?.aborted) return fallback("aborted");
    if (timeout.aborted) return fallback("timeout");
    const name = error instanceof Error ? error.name : "";
    return fallback(/NoObjectGenerated|NoOutputGenerated|JSONParse|TypeValidation/.test(name) ? "invalid-spec" : "model-error");
  }

  const primary = readSpec(output?.primary);
  if (!primary) return fallback("invalid-spec");
  const checked = validateChartSpec(primary, result, { question });
  if (!checked.ok) return fallback("invalid-spec", checked.issues);

  const alternate = readSpec(output.alternate);
  const keepAlternate = alternate !== undefined && validateChartSpec(alternate, result, { question }).ok;
  return finish({ primary, ...(keepAlternate ? { alternate } : {}), source: "model" });
}

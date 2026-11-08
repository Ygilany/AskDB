import { generateText, jsonSchema, Output, type JSONSchema7 } from "ai";
import {
  findMentionedNames,
  maskSqlLiterals,
  sensitiveMentionNames,
  type AnyNormalizedSchema,
  type AskDbLanguageModel,
  type AskDialectInput,
  type NormalizedSchemaV2,
} from "@askdb/core";
import { fallbackChart } from "./fallback.js";
import { buildChartUserPrompt, CHART_SYSTEM_PROMPT } from "./prompt.js";
import { CHART_TYPES, type ChartFallbackReason, type ChartPlan, type ChartSpec, type ChartSpecIssue, type ChartType, type ClassifiedResult } from "./types.js";
import { validateChartSpec } from "./validate.js";

const DEFAULT_TIMEOUT_MS = 15_000;
/** The longest delay a Node timer holds. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

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
  /** The schema artifact the SQL was generated against. With {@link omitSensitiveIdentifiers}, it says which names are sensitive. */
  schema?: AnyNormalizedSchema;
  /**
   * Keep sensitive names out of the prompt, as `ask()`'s `omitSensitiveIdentifiersFromNlToSqlPrompt`
   * does. Pass `modes.omitSensitiveFromPrompt`. With `schema`, SQL that mentions a sensitive
   * column isn't sent, and a result column named like one is shown under a neutral label.
   */
  omitSensitiveIdentifiers?: boolean;
  /** Forwarded to the model call's `providerOptions`, as in `ask()`. */
  providerOptions?: Record<string, unknown>;
  /** Cancels the model call; the plan then comes from the fallback. */
  abortSignal?: AbortSignal;
  /** How long to wait for the model before falling back, in milliseconds. Default 15000; `Infinity` waits for `abortSignal` only. */
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

/**
 * The model's spec as a {@link ChartSpec}, with prompt labels mapped back to column names, or
 * undefined when it isn't one. `jsonSchema()` doesn't validate the model's output, so this does.
 */
function readSpec(value: unknown, toColumn: (shown: string) => string): ChartSpec | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!CHART_TYPES.includes(v.type as ChartType)) return undefined;
  if (!Array.isArray(v.series) || !v.series.every((s) => typeof s === "string")) return undefined;
  if (typeof v.title !== "string" || typeof v.description !== "string") return undefined;
  if (v.category !== undefined && v.category !== null && typeof v.category !== "string") return undefined;
  return {
    type: v.type as ChartType,
    ...(typeof v.category === "string" ? { category: toColumn(v.category) } : {}),
    series: (v.series as string[]).map(toColumn),
    title: v.title,
    description: v.description,
  };
}

/** Bare names of every sensitive column, and the names whose mention marks SQL as naming one. */
function sensitiveNames(schema: AnyNormalizedSchema): { columns: Set<string>; mentions: ReturnType<typeof sensitiveMentionNames> } {
  const columns = new Set<string>();
  for (const table of schema.tables) {
    for (const column of table.columns) if (column.sensitive || table.sensitive) columns.add(column.name);
  }
  const mentions = "schemaId" in schema ? sensitiveMentionNames(schema as NormalizedSchemaV2) : [...columns];
  return { columns, mentions };
}

/**
 * The SQL and column names the prompt may show. A column name that holds a literal (SQLite and
 * MySQL name an unaliased expression by its text) or, under omission, a sensitive name, is
 * shown as `column_<n>`; `toColumn` maps a shown name back.
 */
function promptView(options: PlanChartOptions) {
  const sensitive = options.omitSensitiveIdentifiers && options.schema ? sensitiveNames(options.schema) : undefined;
  let sql = maskSqlLiterals(options.sql, options.dialect);
  if (sql !== undefined && sensitive && findMentionedNames(options.sql, sensitive.mentions).length > 0) sql = undefined;

  const real = options.result.shape.columns.map((c) => c.name);
  const hidden = (name: string) => maskSqlLiterals(name, options.dialect) !== name || sensitive?.columns.has(name) === true;
  const taken = new Set(real.filter((name) => !hidden(name)));
  const shownToReal = new Map<string, string>();
  const columns = options.result.shape.columns.map((column, i) => {
    let shown = column.name;
    if (hidden(column.name)) {
      shown = `column_${i + 1}`;
      while (taken.has(shown)) shown = `${shown}_`;
      taken.add(shown);
    }
    shownToReal.set(shown, column.name);
    return { name: shown, kind: column.kind };
  });
  return { sql, shape: { ...options.result.shape, columns }, toColumn: (shown: string) => shownToReal.get(shown) ?? shown };
}

function timeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === Infinity) return undefined;
  const ms = timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.floor(timeoutMs) : DEFAULT_TIMEOUT_MS;
  return AbortSignal.timeout(Math.min(ms, MAX_TIMEOUT_MS));
}

/**
 * Plans a chart for a query result without sending a row to the model. The model gets the
 * question, the SQL with every literal replaced by `?` (no SQL at all if it can't be read
 * safely), and the result's shape: column names and kinds, the row count and the truncated
 * flag. A column name that holds a literal is shown under a neutral label. It returns a
 * declarative spec, which is checked against the result; an invalid spec, an error, a timeout
 * or an abort gives the deterministic fallback instead. It never rejects because of the model.
 * The host draws the chart from its own rows.
 *
 * @experimental Part of `@askdb/client/charts`, outside AskDB's 1.0 stability promise: a minor release may change it.
 */
export async function planChart(options: PlanChartOptions): Promise<ChartPlan> {
  const started = performance.now();
  const { question, result } = options;
  const finish = (plan: Omit<ChartPlan, "latencyMs">): ChartPlan => ({ ...plan, latencyMs: Math.round(performance.now() - started) });
  const fallback = (fallbackReason: ChartFallbackReason, issues?: ChartSpecIssue[]) =>
    finish({ primary: fallbackChart(question, result), source: "fallback", fallbackReason, ...(issues ? { issues } : {}) });

  const view = promptView(options);
  const timeout = timeoutSignal(options.timeoutMs);
  const signals = [options.abortSignal, timeout].filter((s): s is AbortSignal => s !== undefined);
  const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
  let output: ModelPlan;
  try {
    // Raced against the signal too, so a model that ignores it still can't hold the plan up.
    const signalRejection = new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const call = generateText({
      model: options.model,
      system: CHART_SYSTEM_PROMPT,
      prompt: buildChartUserPrompt(question, view.sql, view.shape),
      output: Output.object({ schema: jsonSchema<ModelPlan>(planSchema) }),
      ...(signal ? { abortSignal: signal } : {}),
      ...(options.providerOptions ? { providerOptions: options.providerOptions as never } : {}),
    });
    // Whichever loses the race settles later; that settlement is expected, not an error.
    call.catch(() => {});
    signalRejection.catch(() => {});
    output = (await Promise.race([call, signalRejection])).output;
  } catch (error) {
    if (options.abortSignal?.aborted) return fallback("aborted");
    if (timeout?.aborted) return fallback("timeout");
    const name = error instanceof Error ? error.name : "";
    return fallback(/NoObjectGenerated|NoOutputGenerated|JSONParse|TypeValidation/.test(name) ? "invalid-spec" : "model-error");
  }

  const primary = readSpec(output?.primary, view.toColumn);
  if (!primary) return fallback("invalid-spec");
  const checked = validateChartSpec(primary, result, { question });
  if (!checked.ok) return fallback("invalid-spec", checked.issues);

  const alternate = readSpec(output.alternate, view.toColumn);
  const keepAlternate = alternate !== undefined && validateChartSpec(alternate, result, { question }).ok;
  return finish({ primary, ...(keepAlternate ? { alternate } : {}), source: "model" });
}

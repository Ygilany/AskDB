import type { AnyNormalizedSchema } from "@askdb/core";

/** What a result column holds, as the chart planner reads it. */
export type ColumnKind = "identifier" | "year" | "date" | "currency" | "percent" | "category" | "measure";

/** A result column as the host's driver reports it. `type` is the database type, when known. */
export type ResultColumnInput = { name: string; type?: string };

/** What the host passes to {@link classifyResult}. Everything here stays in the host process. */
export type ClassifyResultInput = {
  columns: readonly ResultColumnInput[];
  /** How many rows the host has. */
  rowCount: number;
  /** True when the query had more rows than the host returned (a row cap or a page). */
  truncated?: boolean;
  /**
   * Optional: the rows, as objects keyed by column name or as arrays in column order. Read
   * locally to tell numbers from text, find negative values and measure labels. Never sent
   * to a model, and not kept in the result.
   */
  rows?: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[];
  /** Optional: the schema artifact. A column whose name matches exactly one schema column takes its type. */
  schema?: AnyNormalizedSchema;
};

/** What the model is told about one column: its name and kind, nothing else. */
export type ShapeColumn = { name: string; kind: ColumnKind };

/** What the classifier learned about one column. It stays in the host process. */
export type LocalColumnFacts = {
  /** False for averages, rates and other values that don't add up to a whole. */
  additive: boolean;
  /** Set when rows were passed: whether any value is below zero. */
  hasNegative?: boolean;
  /** Set when rows were passed: how many different values the column holds. */
  distinctCount?: number;
  /** Set when rows were passed: the longest value, in characters, for a category. */
  maxLabelLength?: number;
};

export type ClassifiedResult = {
  /** Exactly what the model sees about the result. */
  shape: { columns: ShapeColumn[]; rowCount: number; truncated: boolean };
  /** Facts the validator and the fallback read locally. The prompt never includes them. */
  local: Record<string, LocalColumnFacts>;
};

/** Every chart type, the one list the type, the model's JSON schema and the spec check read. */
export const CHART_TYPES = ["metric", "line", "area", "bar", "horizontal-bar", "pie"] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/**
 * A declarative chart: which columns of the host's own rows to plot, and how. `category` is
 * the column along the axis (or the slices); `series` are the quantitative columns. A metric
 * has no category and one series.
 */
export type ChartSpec = {
  type: ChartType;
  category?: string;
  series: string[];
  title: string;
  description: string;
};

export type ChartSpecIssueCode =
  | "UNKNOWN_COLUMN"
  | "SERIES_NOT_MEASURE"
  | "INVALID_CATEGORY"
  | "METRIC_NOT_SCALAR"
  | "PIE_NOT_PART_TO_WHOLE";

export type ChartSpecIssue = { code: ChartSpecIssueCode; column?: string; message: string };

export type ValidateChartSpecResult = { ok: true } | { ok: false; issues: ChartSpecIssue[] };

export type ChartFallbackReason = "timeout" | "aborted" | "model-error" | "invalid-spec";

export type ChartPlan = {
  /** The chart to draw, or null when no column can be plotted. */
  primary: ChartSpec | null;
  /** A second chart the host may offer instead. */
  alternate?: ChartSpec;
  /** Whether the model planned the chart or the deterministic fallback picked it. */
  source: "model" | "fallback";
  /** Why the fallback was used. */
  fallbackReason?: ChartFallbackReason;
  /** Why the model's spec was refused, when it was. */
  issues?: ChartSpecIssue[];
  /** How long planning took, in milliseconds. */
  latencyMs: number;
};

/**
 * `@askdb/client/charts`: plan a chart for a query result without sending rows to a model.
 *
 * @experimental Outside AskDB's 1.0 stability promise: a minor release of `@askdb/client` may
 * change this entry point (ADR 0030, ADR 0031). It is self-contained, so it can move to its
 * own package later.
 * @packageDocumentation
 */
export { classifyResult } from "./classify.js";
export { planChart, type PlanChartOptions } from "./plan.js";
export { validateChartSpec } from "./validate.js";
export type {
  ChartFallbackReason,
  ChartPlan,
  ChartSpec,
  ChartSpecIssue,
  ChartSpecIssueCode,
  ChartType,
  ClassifiedResult,
  ClassifyResultInput,
  ColumnKind,
  LocalColumnFacts,
  ResultColumnInput,
  ShapeColumn,
  ValidateChartSpecResult,
} from "./types.js";

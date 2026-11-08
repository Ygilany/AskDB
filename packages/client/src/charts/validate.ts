import type { ChartSpec, ChartSpecIssue, ClassifiedResult, ColumnKind, ValidateChartSpecResult } from "./types.js";

const MEASURES: ReadonlySet<ColumnKind> = new Set(["measure", "currency", "percent"]);
const TIME: ReadonlySet<ColumnKind> = new Set(["date", "year"]);

/** A ranking question: top, bottom, highest, lowest… */
export const RANKING = /\b(top|bottom|highest|lowest|most|least|best|worst|largest|smallest|biggest|rank(ed|ing)?)\b/i;

export function isMeasure(kind: ColumnKind): boolean {
  return MEASURES.has(kind);
}

export function isTime(kind: ColumnKind): boolean {
  return TIME.has(kind);
}

/**
 * The part-to-whole policy: a pie only for one additive total or count across 2–8 distinct
 * categories, from a complete result with no negative values, and not for a time series or a
 * ranking. Returns why not, or undefined when a pie fits.
 */
export function pieRefusal(spec: Pick<ChartSpec, "category" | "series">, result: ClassifiedResult, question?: string): string | undefined {
  const { rowCount, truncated } = result.shape;
  const kindOf = (name: string | undefined) => result.shape.columns.find((c) => c.name === name)?.kind;
  if (spec.series.length !== 1) return "a pie shows exactly one series";
  const series = spec.series[0]!;
  const facts = result.local[series];
  if (!facts?.additive) return `${series} doesn't add up to a whole (an average, rate or ratio)`;
  if (facts.hasNegative) return `${series} has negative values`;
  const category = kindOf(spec.category);
  if (category && isTime(category)) return "a time series isn't part of a whole";
  if (rowCount < 2 || rowCount > 8) return `a pie needs 2–8 categories, not ${rowCount}`;
  const distinct = spec.category ? result.local[spec.category]?.distinctCount : undefined;
  if (distinct !== undefined && distinct !== rowCount) return `${spec.category} repeats across rows`;
  if (truncated) return "the result is truncated, so the whole is unknown";
  if (question && RANKING.test(question)) return "a ranking isn't part of a whole";
  return undefined;
}

/**
 * Checks a chart spec against the classified result: every column it names exists, every
 * series is a measure (never an identifier or a year), a chart other than a metric has a
 * category that isn't a measure, a metric is one row and one series, and a pie passes the
 * part-to-whole policy. Pass the question to refuse a pie for a ranking.
 *
 * @experimental Part of `@askdb/client/charts`, outside AskDB's 1.0 stability promise: a minor release may change it.
 */
export function validateChartSpec(
  spec: ChartSpec,
  result: ClassifiedResult,
  context: { question?: string } = {},
): ValidateChartSpecResult {
  const issues: ChartSpecIssue[] = [];
  const kinds = new Map(result.shape.columns.map((c) => [c.name, c.kind]));
  for (const name of [...(spec.category === undefined ? [] : [spec.category]), ...spec.series]) {
    if (!kinds.has(name)) issues.push({ code: "UNKNOWN_COLUMN", column: name, message: `The result has no column ${name}.` });
  }
  if (issues.length > 0) return { ok: false, issues };

  if (spec.series.length === 0) {
    issues.push({ code: "SERIES_NOT_MEASURE", message: "A chart needs at least one series." });
  }
  for (const name of spec.series) {
    if (!isMeasure(kinds.get(name)!)) {
      issues.push({ code: "SERIES_NOT_MEASURE", column: name, message: `${name} is a ${kinds.get(name)}, not a measure.` });
    }
  }

  if (spec.type === "metric") {
    if (result.shape.rowCount !== 1 || spec.series.length !== 1) {
      issues.push({ code: "METRIC_NOT_SCALAR", message: "A metric needs one row and one series." });
    }
  } else if (spec.category === undefined || isMeasure(kinds.get(spec.category)!)) {
    issues.push({
      code: "INVALID_CATEGORY",
      ...(spec.category === undefined ? {} : { column: spec.category }),
      message: `A ${spec.type} chart needs a category column that isn't a measure.`,
    });
  }

  if (spec.type === "pie") {
    const refusal = pieRefusal(spec, result, context.question);
    if (refusal) issues.push({ code: "PIE_NOT_PART_TO_WHOLE", message: `No pie: ${refusal}.` });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

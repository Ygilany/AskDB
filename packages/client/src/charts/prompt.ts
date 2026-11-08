import type { ClassifiedResult } from "./types.js";

export const CHART_SYSTEM_PROMPT = [
  "You plan a chart for the result of a SQL query. You never see the rows: only the question, the query with its literal values replaced by ?, and the result's columns with their kinds.",
  "Return one primary chart and at most one alternate (null when there is none). Each chart has a type, a category column, series columns, a title and a short description.",
  "",
  "Pick the type by these rules, in order:",
  "1. One row with one headline number: metric (no category, one series).",
  "2. A measure over ordered time (a date or year category): line. Use area only when the filled volume is the point.",
  "3. Part of a whole across 2–8 categories: pie, for one additive total or count only.",
  "4. A ranking (top, bottom, highest, lowest…): horizontal-bar.",
  "5. A few short categories: bar (horizontal-bar when the labels are long).",
  "",
  "Rules:",
  "- Never invent a column, a formula or an aggregation. Use only the columns listed, by their exact names.",
  "- Series are measure, currency or percent columns. An identifier or a year is a category, never a series.",
  "- Never a pie for an average, a rate or ratio, a percent, a time series, a ranking, more than one series, or a truncated result.",
  "- Keep titles and descriptions factual: say what is plotted, not what it means.",
].join("\n");

/**
 * The user prompt: the question, the masked SQL (or a note that it isn't shown), and the
 * result's shape. It reads only `result.shape`, never `result.local`.
 */
export function buildChartUserPrompt(question: string, maskedSql: string | undefined, shape: ClassifiedResult["shape"]): string {
  const rows = `${shape.rowCount} ${shape.rowCount === 1 ? "row" : "rows"}`;
  return [
    `Question: ${question}`,
    "",
    ...(maskedSql === undefined ? ["SQL: not shown (it couldn't be read safely)."] : ["SQL (literals replaced with ?):", maskedSql]),
    "",
    `Result shape: ${rows}${shape.truncated ? " (truncated: more rows exist than the host returned)" : ""}.`,
    "Columns:",
    ...shape.columns.map((c) => `- ${c.name} (${c.kind})`),
  ].join("\n");
}

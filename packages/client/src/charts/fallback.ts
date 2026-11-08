import { words } from "./classify.js";
import type { ChartSpec, ChartType, ClassifiedResult } from "./types.js";
import { RANKING, isMeasure, isTime, pieRefusal } from "./validate.js";

const PART_OF_WHOLE = /\b(share|shares|breakdown|split|proportion|distribution|percent(age)? of|portion|mix)\b/i;
const LONG_LABEL = 16;
const MAX_SERIES = 4;

/** `order_count` → `order count`. */
function label(name: string): string {
  return words(name).join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DESCRIBE: Record<ChartType, string> = {
  metric: "The single value of",
  line: "Line chart of",
  area: "Area chart of",
  bar: "Bar chart of",
  "horizontal-bar": "Horizontal bar chart of",
  pie: "Pie chart of",
};

/**
 * The deterministic chart for a classified result, following the planner's rubric: one row → a
 * metric; a time column → a line; a part-of-whole question that passes the policy → a pie; a
 * ranking → a horizontal bar; otherwise a bar, horizontal when labels are long. Null when the
 * result has no measure to plot.
 */
export function fallbackChart(question: string, result: ClassifiedResult): ChartSpec | null {
  const measures = result.shape.columns.filter((c) => isMeasure(c.kind)).map((c) => c.name);
  if (measures.length === 0) return null;
  const dimensions = result.shape.columns.filter((c) => !isMeasure(c.kind));
  const series = measures.slice(0, MAX_SERIES);
  const seriesLabel = series.map(label).join(", ");

  if (result.shape.rowCount === 1) {
    const only = measures[0]!;
    return { type: "metric", series: [only], title: capitalize(label(only)), description: `${DESCRIBE.metric} ${label(only)}.` };
  }

  const time = dimensions.find((c) => isTime(c.kind));
  const category =
    time ?? dimensions.find((c) => c.kind === "category") ?? dimensions.find((c) => c.kind === "identifier");
  if (!category) return null;

  let type: ChartType;
  if (time) type = "line";
  else if (PART_OF_WHOLE.test(question) && !pieRefusal({ category: category.name, series: [series[0]!] }, result, question)) type = "pie";
  else if (RANKING.test(question)) type = "horizontal-bar";
  else type = (result.local[category.name]?.maxLabelLength ?? 0) > LONG_LABEL ? "horizontal-bar" : "bar";

  const plotted = type === "pie" ? [series[0]!] : series;
  const plottedLabel = type === "pie" ? label(series[0]!) : seriesLabel;
  return {
    type,
    category: category.name,
    series: plotted,
    title: `${capitalize(plottedLabel)} by ${label(category.name)}`,
    description:
      type === "pie"
        ? `Each ${label(category.name)}'s share of the total ${plottedLabel}.`
        : `${DESCRIBE[type]} ${plottedLabel} for each ${label(category.name)}.`,
  };
}

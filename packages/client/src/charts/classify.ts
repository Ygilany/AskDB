import type { AnyNormalizedSchema } from "@askdb/core";
import type { ClassifiedResult, ClassifyResultInput, ColumnKind, LocalColumnFacts } from "./types.js";

const YEAR = new Set(["year", "yr", "fy"]);
const DATE = new Set(["date", "day", "week", "month", "quarter", "time", "timestamp", "at", "on", "period", "datetime"]);
const PERCENT = new Set(["pct", "percent", "percentage", "rate", "ratio", "share"]);
const CURRENCY = new Set(["amount", "cost", "costs", "revenue", "total", "price", "sales", "spend", "income", "profit", "fee", "fees", "balance", "payment", "salary", "arr", "mrr"]);
const MEASURE = new Set(["count", "num", "number", "qty", "quantity", "sum", "avg", "average", "mean", "median", "min", "max", "score", "units"]);
const NOT_ADDITIVE = new Set(["avg", "average", "mean", "median", "min", "max"]);

const NUMERIC_TYPE = /\b(int\d*|integer|bigint|smallint|tinyint|mediumint|decimal|numeric|number|real|float\d*|double|money|smallmoney)\b/i;
const DATE_TYPE = /\b(date|time|timestamp|timestamptz|datetime\d*|smalldatetime|interval)\b/i;
const MONEY_TYPE = /\b(money|smallmoney)\b/i;
const ISO_DATE = /^\d{4}-\d{2}(-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?$/;
const NUMERIC_STRING = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** Splits `fiscalYear`, `fiscal_year` and `fiscal year` into lower-case words. */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function schemaTypes(schema: AnyNormalizedSchema | undefined): Map<string, string | null> {
  const types = new Map<string, string | null>();
  for (const table of schema?.tables ?? []) {
    for (const column of table.columns) {
      // A name on more than one schema column doesn't decide a type.
      types.set(column.name, types.has(column.name) ? null : column.type);
    }
  }
  return types;
}

type ValueFacts = { numeric: boolean; date: boolean; hasNegative: boolean; distinctCount: number; maxLabelLength: number };

function readValues(values: readonly unknown[]): ValueFacts | undefined {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length === 0) return undefined;
  const numbers = present.map((v) =>
    typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && NUMERIC_STRING.test(v.trim()) ? Number(v) : undefined,
  );
  const numeric = numbers.every((n) => n !== undefined && Number.isFinite(n));
  const date = present.every((v) => v instanceof Date || (typeof v === "string" && ISO_DATE.test(v.trim())));
  return {
    numeric,
    date,
    hasNegative: numeric && numbers.some((n) => n! < 0),
    distinctCount: new Set(present.map((v) => (v instanceof Date ? v.getTime() : String(v)))).size,
    maxLabelLength: Math.max(...present.map((v) => String(v).length)),
  };
}

function kindOf(name: string, type: string | undefined, values: ValueFacts | undefined): ColumnKind {
  const w = words(name);
  const last = w.at(-1);
  if (last === "id" || last === "uuid") return "identifier";
  if ((type && DATE_TYPE.test(type) && !NUMERIC_TYPE.test(type)) || (values?.date && !values.numeric)) return "date";
  // A year or date word names the column's time only when nothing says it is a quantity of
  // something per unit of time: `revenue_per_year`, `orders_per_day`, `avg_response_time`.
  const quantity = w.some((x) => x === "per" || PERCENT.has(x) || CURRENCY.has(x) || MEASURE.has(x));
  if (!quantity && w.some((x) => YEAR.has(x))) return "year";
  if (!quantity && w.some((x) => DATE.has(x)) && !(type && NUMERIC_TYPE.test(type)) && !values?.numeric) return "date";

  // Numbers: the database type decides first, then the values, then the name.
  const numeric = type ? NUMERIC_TYPE.test(type) : values ? values.numeric : w.some((x) => PERCENT.has(x) || CURRENCY.has(x) || MEASURE.has(x));
  if (!numeric) return "category";
  if (w.some((x) => PERCENT.has(x))) return "percent";
  if ((type && MONEY_TYPE.test(type)) || w.some((x) => CURRENCY.has(x))) return "currency";
  return "measure";
}

/**
 * Classifies a query result's columns, in the host process, for {@link planChart}. Names come
 * first (`*_id` is an identifier, `year` a year, `revenue` currency, `rate` a percent), then the
 * database type (from `columns[].type`, or from the schema artifact), then the rows if passed.
 *
 * The result splits what the model may see (`shape`: names, kinds, row count, truncated) from
 * what stays local (`local`: negatives, distinct counts, label lengths). Row values never leave.
 *
 * @experimental Part of `@askdb/client/charts`, outside AskDB's 1.0 stability promise: a minor release may change it.
 */
export function classifyResult(input: ClassifyResultInput): ClassifiedResult {
  const fromSchema = schemaTypes(input.schema);
  const columns: ClassifiedResult["shape"]["columns"] = [];
  const local: ClassifiedResult["local"] = {};
  input.columns.forEach((column, index) => {
    const values = input.rows
      ? readValues(input.rows.map((row) => (Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[column.name])))
      : undefined;
    const type = column.type ?? fromSchema.get(column.name) ?? undefined;
    const kind = kindOf(column.name, type, values);
    columns.push({ name: column.name, kind });
    const facts: LocalColumnFacts = { additive: kind !== "percent" && !words(column.name).some((x) => NOT_ADDITIVE.has(x)) };
    if (values) {
      facts.hasNegative = values.hasNegative;
      facts.distinctCount = values.distinctCount;
      facts.maxLabelLength = values.maxLabelLength;
    }
    local[column.name] = facts;
  });
  return { shape: { columns, rowCount: input.rowCount, truncated: input.truncated === true }, local };
}

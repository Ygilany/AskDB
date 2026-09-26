/**
 * Value normalization for cross-dialect comparison. The rules, and the reason for
 * each, are documented in dataset/NORMALIZATION.md; keep the two in sync.
 */

export type LogicalType = "int" | "bigint" | "decimal" | "boolean" | "date" | "timestamp" | "text";
export type Normalized = string | boolean | null;

/** Aggregates such as AVG are compared at this many decimal places. */
export const DECIMAL_PLACES = 6;

export function normalizeValue(value: unknown, type: LogicalType): Normalized {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "int":
    case "bigint":
      return normalizeInteger(value);
    case "decimal":
      return normalizeDecimal(value);
    case "boolean":
      return normalizeBoolean(value);
    case "date":
      return normalizeDate(value);
    case "timestamp":
      return normalizeTimestamp(value);
    case "text":
      return String(value).normalize("NFC");
  }
}

function normalizeInteger(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return BigInt(value.trim()).toString();
  throw new Error(`Not an integer: ${JSON.stringify(value)}`);
}

/**
 * Decimal → plain decimal string, rounded half-up to {@link DECIMAL_PLACES},
 * with trailing zeros removed: `12.50` → `12.5`, `3.00` → `3`.
 * Numbers go through toFixed so float noise from SQLite REAL storage rounds away.
 */
function normalizeDecimal(value: unknown): string {
  let text: string;
  if (typeof value === "number") text = value.toFixed(DECIMAL_PLACES + 2);
  else if (typeof value === "bigint") text = value.toString();
  else if (typeof value === "string") text = value.trim();
  else throw new Error(`Not a decimal: ${JSON.stringify(value)}`);

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`Not a decimal: ${JSON.stringify(value)}`);
  const [, sign, intPart = "", fracPart = ""] = match;
  const padded = (fracPart + "0".repeat(DECIMAL_PLACES + 1)).slice(0, DECIMAL_PLACES + 1);
  // Scaled integer with one guard digit, then round half-up on the guard digit.
  let scaled = BigInt((intPart || "0") + padded);
  scaled = (scaled + 5n) / 10n;
  const digits = scaled.toString().padStart(DECIMAL_PLACES + 1, "0");
  const whole = digits.slice(0, -DECIMAL_PLACES);
  const frac = digits.slice(-DECIMAL_PLACES).replace(/0+$/, "");
  const magnitude = frac ? `${whole}.${frac}` : whole;
  return sign === "-" && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "t" || value === "true" || value === 1n) return true;
  if (value === 0 || value === "0" || value === "f" || value === "false" || value === 0n) return false;
  throw new Error(`Not a boolean: ${JSON.stringify(value)}`);
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`Not a date: ${JSON.stringify(value)}`);
  return text.slice(0, 10);
}

/** Timestamp → `YYYY-MM-DDTHH:MM:SS` (naive UTC, whole seconds). */
function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  const text = String(value).replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) throw new Error(`Not a timestamp: ${JSON.stringify(value)}`);
  return text.slice(0, 19);
}

/**
 * Normalize a result set for comparison: columns by position (labels are
 * ignored), every value by its declared logical type, rows sorted unless the
 * caller says order is part of the contract.
 */
export function normalizeRows(
  rows: readonly (readonly unknown[])[],
  types: readonly LogicalType[],
  opts: { ordered?: boolean } = {},
): Normalized[][] {
  const out = rows.map((row) => {
    if (row.length !== types.length) {
      throw new Error(`Row has ${row.length} columns, expected ${types.length}: ${JSON.stringify(row)}`);
    }
    return row.map((v, i) => normalizeValue(v, types[i]!));
  });
  if (!opts.ordered) out.sort((a, b) => compareKeys(JSON.stringify(a), JSON.stringify(b)));
  return out;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

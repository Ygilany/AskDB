import {
  QueryParameterError,
  type QueryParameterRejectionReason,
} from "../errors.js";
import {
  BUILT_IN_DIALECTS,
  type BuiltInDialectId,
  type DialectSpec,
} from "./dialect-spec.js";
import { GENERIC_LEXER, lexSql, lexerProfileFor } from "./lexer.js";
import { validateSelectSql } from "./validate.js";

// ---------------------------------------------------------------------------
// Public parameter types (owned by the binder; re-exported from barrels)
// ---------------------------------------------------------------------------

export type QueryParameterType = "string" | "number" | "boolean" | "date" | "datetime";
export type QueryParameterValue = string | number | boolean;
/** One slot in `BoundQuery.params` — a scalar, or an array for Postgres/CockroachDB listBinding. */
export type QueryParamSlot = QueryParameterValue | QueryParameterValue[];

/** One parameter as bound for this call — enough to render a form field. */
export type QueryParameterBinding = {
  name: string;
  placeholder: string;
  type: QueryParameterType;
  cardinality: "one" | "many";
  description?: string;
  value: QueryParameterValue | QueryParameterValue[];
  /** Driver markers this parameter fills in `unboundSql`, in order. */
  markers: string[];
  /** 0-based indices into `params` this parameter occupies, in order. */
  indices: number[];
  source: "question" | "tenant";
};

/** Serializable input to bindPreparedQuery(). Definitions and template only — no values. */
export type PreparedQuery = {
  version: 1;
  dialect: BuiltInDialectId;
  /** SQL with unquoted `:name` / `:tenant_*` placeholders intact. */
  namedSql: string;
  parameters: Array<{
    name: string;
    placeholder: string;
    type: QueryParameterType;
    cardinality: "one" | "many";
    description?: string;
    source: "question" | "tenant";
  }>;
};

export type BoundQuery = {
  /** Ready to run as-is — every placeholder replaced with an escaped literal. */
  sql: string;
  /** Same statement with driver markers instead of literals. */
  unboundSql: string;
  params: QueryParamSlot[];
  bindings: QueryParameterBinding[];
};

// ---------------------------------------------------------------------------
// Spans — code / quoted / comment regions, from the shared lexer
// ---------------------------------------------------------------------------

export type SqlSpanKind = "code" | "quoted" | "comment";

export type SqlSpan = {
  kind: SqlSpanKind;
  start: number;
  end: number;
};

/**
 * Split SQL into contiguous code / quoted / comment regions using the shared lexer
 * (`lexer.ts`). With a dialect, strings, quoted identifiers, and comments follow that
 * engine's rules (Postgres `E'…'` and exact-tag `$tag$…$tag$`, MySQL backslash escapes
 * and `#` comments, SQL Server `[…]`, …). Without one, the generic profile recognizes
 * the union of quoting forms. An unterminated quote or comment runs to the end.
 */
export function tokenizeSqlSpans(
  sql: string,
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">,
): SqlSpan[] {
  const profile = (dialect && lexerProfileFor(dialect)) ?? GENERIC_LEXER;
  const spans: SqlSpan[] = [];
  let codeStart = 0;
  const pushCode = (end: number): void => {
    if (end > codeStart) spans.push({ kind: "code", start: codeStart, end });
  };
  for (const token of lexSql(sql, profile)) {
    const kind: SqlSpanKind | undefined =
      token.kind === "string" || token.kind === "quoted_identifier"
        ? "quoted"
        : token.kind === "comment"
          ? "comment"
          : undefined;
    if (!kind) continue;
    pushCode(token.start);
    spans.push({ kind, start: token.start, end: token.end });
    codeStart = token.end;
  }
  pushCode(sql.length);
  return spans;
}

// ---------------------------------------------------------------------------
// Placeholder scanner
// ---------------------------------------------------------------------------

export type PlaceholderOccurrence = {
  /** Name without the leading colon, e.g. "state_name" or "tenant_agency_ids". */
  name: string;
  /** Full token including colon, e.g. ":state_name". */
  placeholder: string;
  start: number;
  end: number;
};

// `(?<!:)` keeps the type in a `value::type` cast from reading as a `:type` placeholder.
const PLACEHOLDER_TOKEN_RE = /(?<!:):([a-z][a-z0-9_]*)/g;

/**
 * Find `:name` placeholders only in code regions, in source order.
 * A quoted `':name'` or a commented-out `-- :name` is invisible by construction.
 */
export function scanPlaceholders(
  sql: string,
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">,
): PlaceholderOccurrence[] {
  const spans = tokenizeSqlSpans(sql, dialect);
  const out: PlaceholderOccurrence[] = [];
  for (const span of spans) {
    if (span.kind !== "code") continue;
    const segment = sql.slice(span.start, span.end);
    PLACEHOLDER_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_TOKEN_RE.exec(segment)) !== null) {
      const name = m[1]!;
      const start = span.start + m.index;
      const end = start + m[0]!.length;
      out.push({ name, placeholder: m[0]!, start, end });
    }
  }
  return out;
}

/**
 * `:tenant_<root>_ids` placeholders in code regions. Pass the dialect so strings and
 * comments are recognized the way the target engine reads them (MySQL backslash
 * escapes and `#` comments, Postgres nested block comments, …); without one the
 * generic profile is used.
 */
export function scanTenantPlaceholders(
  sql: string,
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">,
): PlaceholderOccurrence[] {
  return scanPlaceholders(sql, dialect).filter((p) => /^tenant_[a-z0-9_]+_ids$/.test(p.name));
}

// ---------------------------------------------------------------------------
// List-context validation
// ---------------------------------------------------------------------------

/**
 * A `many` placeholder must be the sole expression inside `IN (...)` / `NOT IN (...)`,
 * or the sole argument of `= ANY(...)` on array dialects.
 */
export function isValidListContext(
  sql: string,
  occurrence: PlaceholderOccurrence,
  listBinding: "array" | "expand",
): boolean {
  const before = sql.slice(0, occurrence.start);
  const after = sql.slice(occurrence.end);

  const inBefore = /(?:NOT\s+)?IN\s*\(\s*$/i.exec(before);
  if (inBefore) {
    return /^\s*\)/.test(after);
  }

  if (listBinding === "array") {
    const anyBefore = /=\s*ANY\s*\(\s*$/i.exec(before);
    if (anyBefore) {
      return /^\s*\)/.test(after);
    }
  }

  return false;
}

/** Detect whether an occurrence sits inside IN ( … ) and return the span of `IN (` … `)`. */
function inListSpan(
  sql: string,
  occ: PlaceholderOccurrence,
): { start: number; end: number; isNot: boolean } | undefined {
  const before = sql.slice(0, occ.start);
  const after = sql.slice(occ.end);
  const inBefore = /(?:NOT\s+)?IN\s*\(\s*$/i.exec(before);
  if (!inBefore || !/^\s*\)/.test(after)) return undefined;
  const closeMatch = /^\s*\)/.exec(after)!;
  return {
    start: occ.start - inBefore[0]!.length,
    end: occ.end + closeMatch[0]!.length,
    isNot: /^NOT\s+/i.test(inBefore[0]!),
  };
}

function anySpan(
  sql: string,
  occ: PlaceholderOccurrence,
): { start: number; end: number } | undefined {
  const before = sql.slice(0, occ.start);
  const after = sql.slice(occ.end);
  const anyBefore = /=\s*ANY\s*\(\s*$/i.exec(before);
  if (!anyBefore || !/^\s*\)/.test(after)) return undefined;
  const closeMatch = /^\s*\)/.exec(after)!;
  return {
    start: occ.start - anyBefore[0]!.length,
    end: occ.end + closeMatch[0]!.length,
  };
}

// ---------------------------------------------------------------------------
// Dialect-aware literal escaping
// ---------------------------------------------------------------------------

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Escape a scalar value as a SQL literal for the given dialect.
 * Never includes the raw parameter value in thrown error messages.
 */
export function escapeSqlLiteral(
  value: QueryParameterValue,
  dialect: Pick<DialectSpec, "backslashEscapes"> | undefined,
): string {
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw paramError("INVALID_VALUE", "Numeric parameter must be a finite number.");
    }
    return String(value);
  }
  if (CONTROL_CHAR_RE.test(value)) {
    throw paramError(
      "INVALID_VALUE",
      "String parameter contains a disallowed control character.",
    );
  }
  let escaped = value.replace(/'/g, "''");
  if (dialect?.backslashEscapes === true) {
    escaped = escaped.replace(/\\/g, "\\\\");
  }
  return `'${escaped}'`;
}

export function escapeSqlLiteralList(
  values: readonly QueryParameterValue[],
  dialect: Pick<DialectSpec, "backslashEscapes"> | undefined,
): string {
  return `(${values.map((v) => escapeSqlLiteral(v, dialect)).join(", ")})`;
}

/** Quote-doubling only — used when no dialect is supplied (legacy tenant path). */
export function escapeSqlLiteralLegacy(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

// ---------------------------------------------------------------------------
// Marker allocation
// ---------------------------------------------------------------------------

export type MarkerStyle = "dollar" | "question" | "atp";

export function markerStyleForDialect(id: BuiltInDialectId): MarkerStyle {
  switch (id) {
    case "postgres":
    case "cockroachdb":
      return "dollar";
    case "sqlserver":
      return "atp";
    case "mysql":
    case "mariadb":
    case "sqlite":
      return "question";
  }
}

export function formatMarker(style: MarkerStyle, ordinal: number): string {
  switch (style) {
    case "dollar":
      return `$${ordinal}`;
    case "question":
      return "?";
    case "atp":
      return `@p${ordinal}`;
  }
}

function listBindingOf(spec: DialectSpec): "array" | "expand" {
  return spec.listBinding ?? "expand";
}

function nextMarker(style: MarkerStyle, counters: { dollar: number; atp: number }): string {
  switch (style) {
    case "dollar":
      return formatMarker("dollar", counters.dollar++);
    case "atp":
      return formatMarker("atp", counters.atp++);
    case "question":
      return formatMarker("question", 0);
  }
}

// ---------------------------------------------------------------------------
// bindPreparedQuery
// ---------------------------------------------------------------------------

function paramError(reason: QueryParameterRejectionReason, message: string): QueryParameterError {
  return new QueryParameterError(message, reason);
}

function lookupValue(
  values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
  name: string,
  placeholder: string,
): QueryParameterValue | readonly QueryParameterValue[] | undefined {
  if (Object.prototype.hasOwnProperty.call(values, placeholder)) {
    return values[placeholder];
  }
  if (Object.prototype.hasOwnProperty.call(values, name)) {
    return values[name];
  }
  return undefined;
}

function assertValueMatchesDeclaration(
  value: QueryParameterValue | readonly QueryParameterValue[],
  type: QueryParameterType,
  cardinality: "one" | "many",
): QueryParameterValue | QueryParameterValue[] {
  if (cardinality === "many") {
    if (!Array.isArray(value)) {
      throw paramError("INVALID_VALUE", "List parameter requires a non-empty array value.");
    }
    if (value.length === 0) {
      throw paramError("INVALID_VALUE", "List parameter requires a non-empty array value.");
    }
    return value.map((v) => assertScalar(v, type));
  }
  if (Array.isArray(value)) {
    throw paramError("INVALID_VALUE", "Scalar parameter must not be an array.");
  }
  return assertScalar(value, type);
}

function assertScalar(value: unknown, type: QueryParameterType): QueryParameterValue {
  if (value === null || value === undefined) {
    throw paramError("INVALID_VALUE", "Parameter value must not be null or undefined.");
  }
  if (typeof value === "object") {
    throw paramError("INVALID_VALUE", "Parameter value must be a string, number, or boolean.");
  }
  switch (type) {
    case "string":
    case "date":
    case "datetime":
      if (typeof value !== "string") {
        throw paramError("INVALID_VALUE", `Parameter of type ${type} requires a string value.`);
      }
      if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw paramError("INVALID_VALUE", "Date parameter must be an ISO date string (YYYY-MM-DD).");
      }
      if (
        type === "datetime" &&
        !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)
      ) {
        throw paramError("INVALID_VALUE", "Datetime parameter must be an ISO datetime string.");
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw paramError("INVALID_VALUE", "Numeric parameter must be a finite number.");
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw paramError("INVALID_VALUE", "Boolean parameter requires a boolean value.");
      }
      return value;
  }
}

type Edit = { start: number; end: number; literal: string; marker: string };

/**
 * Pure, synchronous binder. Substitutes placeholders with escaped literals and
 * allocates dialect-correct driver markers. Does not authorize tenant IDs.
 */
export function bindPreparedQuery(
  prepared: PreparedQuery,
  values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
): BoundQuery {
  const spec = BUILT_IN_DIALECTS[prepared.dialect];
  if (!spec) {
    throw paramError("DIALECT_UNSUPPORTED", `Unknown dialect '${prepared.dialect}'.`);
  }
  const listBinding = listBindingOf(spec);
  const style = markerStyleForDialect(prepared.dialect);
  const namedSql = prepared.namedSql;

  const occurrences = scanPlaceholders(namedSql, spec);
  const declByName = new Map(prepared.parameters.map((p) => [p.name, p]));

  for (const p of prepared.parameters) {
    if (!occurrences.some((o) => o.name === p.name)) {
      throw paramError(
        "UNRESOLVED_PLACEHOLDER",
        `Declared parameter '${p.name}' does not appear in namedSql.`,
      );
    }
  }
  for (const occ of occurrences) {
    if (!declByName.has(occ.name)) {
      throw paramError(
        "UNRESOLVED_PLACEHOLDER",
        `Placeholder '${occ.placeholder}' has no matching parameter declaration.`,
      );
    }
  }

  const resolvedValues = new Map<string, QueryParameterValue | QueryParameterValue[]>();
  for (const p of prepared.parameters) {
    const raw = lookupValue(values, p.name, p.placeholder);
    if (raw === undefined) {
      throw paramError("MISSING_VALUE", `Missing value for parameter '${p.name}'.`);
    }
    resolvedValues.set(p.name, assertValueMatchesDeclaration(raw, p.type, p.cardinality));
  }

  for (const occ of occurrences) {
    const decl = declByName.get(occ.name)!;
    if (decl.cardinality === "many" && !isValidListContext(namedSql, occ, listBinding)) {
      throw paramError(
        "INVALID_LIST_CONTEXT",
        `List parameter '${occ.name}' must appear as the sole expression inside IN (...)` +
          (listBinding === "array" ? " or = ANY(...)" : "") +
          ".",
      );
    }
  }

  const edits: Edit[] = [];
  const params: QueryParamSlot[] = [];
  const bindings: QueryParameterBinding[] = [];
  const bindingByName = new Map<string, QueryParameterBinding>();
  const counters = { dollar: 1, atp: 0 };

  const ensureBinding = (
    decl: PreparedQuery["parameters"][number],
    value: QueryParameterValue | QueryParameterValue[],
  ): QueryParameterBinding => {
    let binding = bindingByName.get(decl.name);
    if (!binding) {
      binding = {
        name: decl.name,
        placeholder: decl.placeholder,
        type: decl.type,
        cardinality: decl.cardinality,
        description: decl.description,
        value,
        markers: [],
        indices: [],
        source: decl.source,
      };
      bindingByName.set(decl.name, binding);
      bindings.push(binding);
    }
    return binding;
  };

  for (const occ of occurrences) {
    const decl = declByName.get(occ.name)!;
    const value = resolvedValues.get(occ.name)!;

    if (decl.cardinality === "many") {
      const list = value as QueryParameterValue[];
      const listLiteral = escapeSqlLiteralList(list, spec);
      const binding = ensureBinding(decl, value);

      if (listBinding === "array") {
        // One array-typed driver param. unboundSql uses = ANY($n); bound sql uses IN (...).
        const marker = nextMarker(style, counters);
        const indices = [params.length];
        params.push(list);
        binding.markers.push(marker);
        binding.indices.push(...indices);

        const inSp = inListSpan(namedSql, occ);
        const anySp = anySpan(namedSql, occ);
        if (inSp) {
          edits.push({
            start: inSp.start,
            end: inSp.end,
            literal: `${inSp.isNot ? "NOT " : ""}IN ${listLiteral}`,
            marker: inSp.isNot ? `<> ALL(${marker})` : `= ANY(${marker})`,
          });
        } else if (anySp) {
          edits.push({
            start: anySp.start,
            end: anySp.end,
            literal: `IN ${listLiteral}`,
            marker: `= ANY(${marker})`,
          });
        } else {
          // Validated above; defensive.
          edits.push({
            start: occ.start,
            end: occ.end,
            literal: listLiteral,
            marker,
          });
        }
      } else {
        // expand: one marker / literal element per value
        const markerTexts: string[] = [];
        for (const item of list) {
          const marker = nextMarker(style, counters);
          markerTexts.push(marker);
          binding.indices.push(params.length);
          binding.markers.push(marker);
          params.push(item);
        }
        const inSp = inListSpan(namedSql, occ);
        if (inSp) {
          // Replace only the placeholder — outer IN ( ) stays; emit bare list.
          edits.push({
            start: occ.start,
            end: occ.end,
            literal: list.map((v) => escapeSqlLiteral(v, spec)).join(", "),
            marker: markerTexts.join(", "),
          });
        } else {
          edits.push({
            start: occ.start,
            end: occ.end,
            literal: listLiteral,
            marker: `(${markerTexts.join(", ")})`,
          });
        }
      }
    } else {
      const scalar = value as QueryParameterValue;
      const literal = escapeSqlLiteral(scalar, spec);
      const marker = nextMarker(style, counters);
      const binding = ensureBinding(decl, value);
      binding.markers.push(marker);
      binding.indices.push(params.length);
      params.push(scalar);
      edits.push({ start: occ.start, end: occ.end, literal, marker });
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let sql = namedSql;
  let unboundSql = namedSql;
  for (const edit of edits) {
    sql = sql.slice(0, edit.start) + edit.literal + sql.slice(edit.end);
    unboundSql = unboundSql.slice(0, edit.start) + edit.marker + unboundSql.slice(edit.end);
  }

  if (scanPlaceholders(sql, spec).length > 0 || scanPlaceholders(unboundSql, spec).length > 0) {
    throw paramError("UNRESOLVED_PLACEHOLDER", "One or more placeholders remain after binding.");
  }

  validateSelectSql(spec, sql);
  validateSelectSql(spec, unboundSql);

  return { sql, unboundSql, params, bindings };
}

/**
 * Compare two SQL strings structurally for the parameterize consistency check.
 */
export function sqlStructurallyEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/;\s*$/, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  return norm(a) === norm(b);
}

import {
  SensitiveReferenceError,
  type SensitiveMatchKind,
  type SensitiveReference,
  type SensitiveReferenceRuleCode,
  type SensitiveScopeIssue,
  type SensitiveScopeReport,
} from "../errors.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { DialectSpec } from "./dialect-spec.js";
import {
  ENGINE_LEXER_PROFILES,
  GENERIC_LEXER,
  hasUnterminatedToken,
  lexSql,
  lexerProfileFor,
  type SqlToken,
} from "./lexer.js";

export type SensitiveGuardrailMode = "warn" | "strict";

export type ValidateSensitiveReferencesOptions = {
  /**
   * `"warn"` (default) returns the references without throwing — today's CLI behaviour.
   * `"strict"` throws {@link SensitiveReferenceError} whenever the statement cannot be
   * proven clean (references found, or scope could not be resolved).
   */
  mode?: SensitiveGuardrailMode;
  /**
   * The engine the SQL targets, so strings, quoted identifiers, and comments are lexed
   * the way that engine reads them (e.g. MySQL backslash escapes, Postgres `E'…'`).
   * When omitted, references are collected under every built-in engine's reading, which
   * is conservative and can over-report in rare cases.
   */
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">;
};

export type SensitiveGuardrailResult = {
  /** True only when nothing sensitive was referenced **and** table scope was fully resolved. */
  passed: boolean;
  references: SensitiveReference[];
  /** Present when the statement's `FROM`/`JOIN` scope could not be resolved with confidence. */
  unresolvedScope?: SensitiveScopeReport;
};

/**
 * Check whether a SQL statement references tables/columns marked `sensitive`
 * in the schema artifact.
 *
 * `sensitive: true` is otherwise a **prompt-level** marker: `formatSchemaForNlToSql`
 * either tags identifiers `(sensitive)` or withholds them entirely. Both act on what
 * the model *sees*. This function is the **enforcement** path — it inspects SQL that
 * is about to execute, so hosts that cache, store, or replay statements should call it
 * on every execution path, not only at generation time.
 *
 * Unlike a bare substring scan, an unqualified column name only counts when the owning
 * table is actually in the statement's scope: `FROM`/`JOIN` targets and their aliases
 * are resolved first. When scope cannot be resolved (no resolvable table source, or a
 * qualifier that binds to nothing known), the check fails conservatively — it widens
 * matching and reports why in {@link SensitiveGuardrailResult.unresolvedScope} — rather
 * than passing silently. A string, quoted identifier, or comment that never closes is
 * reported the same way (`UNTERMINATED_TOKEN`).
 *
 * `SELECT *`, `alias.*`, and whole-row references such as `row_to_json(alias)` count as
 * referencing every sensitive column of the table they reach.
 *
 * Heuristic, not a SQL parser, and not a security boundary. It is defense in depth for
 * review and enforcement; database-side column privileges are the real control.
 */
export function validateSensitiveReferences(
  sql: string,
  schema: AnyNormalizedSchema,
  options?: ValidateSensitiveReferencesOptions,
): SensitiveGuardrailResult {
  const mode = options?.mode ?? "warn";
  const index = indexSchema(schema);

  const result: SensitiveGuardrailResult = index.hasSensitive
    ? scanSql(sql, index, options?.dialect)
    : { passed: true, references: [] };

  if (mode === "strict" && !result.passed) {
    throw new SensitiveReferenceError(
      buildStrictMessage(result),
      ruleFor(result),
      result.references,
      result.unresolvedScope,
    );
  }
  return result;
}

/**
 * True when the schema marks at least one table or column `sensitive`. Cheap pre-check
 * for hosts (and `ask()`) that skip the guardrail entirely on schemas with no markers.
 */
export function schemaHasSensitiveIdentifiers(schema: AnyNormalizedSchema): boolean {
  return indexSchema(schema).hasSensitive;
}

/** Render a reference as `schema.table.column` (or `table.column` when the schema has no namespace). */
export function formatSensitiveReference(ref: SensitiveReference): string {
  const table = ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
  return `${table}.${ref.column}`;
}

// ---------------------------------------------------------------------------
// Strict-mode messaging
// ---------------------------------------------------------------------------

function ruleFor(result: SensitiveGuardrailResult): SensitiveReferenceRuleCode {
  if (result.references.some((r) => r.matchKind === "table")) return "SENSITIVE_TABLE_REFERENCED";
  if (result.references.length > 0) return "SENSITIVE_COLUMN_REFERENCED";
  return "UNRESOLVED_TABLE_SCOPE";
}

function buildStrictMessage(result: SensitiveGuardrailResult): string {
  const parts: string[] = [];
  if (result.references.length > 0) {
    parts.push(
      `SQL references sensitive identifiers: ${result.references.map(formatSensitiveReference).join(", ")}`,
    );
  }
  if (result.unresolvedScope) parts.push(result.unresolvedScope.message);
  return `Sensitive-identifier guardrail failed (strict mode): ${parts.join("; ")}`;
}

// ---------------------------------------------------------------------------
// Schema index
// ---------------------------------------------------------------------------

type ColumnEntry = { name: string; lower: string; sensitive: boolean; order: number };

type TableEntry = {
  name: string;
  schema?: string;
  lower: string;
  schemaLower?: string;
  sensitive: boolean;
  order: number;
  columns: ColumnEntry[];
  byColumn: Map<string, ColumnEntry>;
};

type SchemaIndex = {
  tables: TableEntry[];
  byName: Map<string, TableEntry[]>;
  hasSensitive: boolean;
};

/** Loaded schemas are long-lived and re-used across calls; index once per object. */
const indexCache = new WeakMap<object, SchemaIndex>();

type LooseTable = {
  name: string;
  schema?: string;
  sensitive?: boolean;
  columns: Array<{ name: string; sensitive?: boolean }>;
};

function indexSchema(schema: AnyNormalizedSchema): SchemaIndex {
  const cached = indexCache.get(schema);
  if (cached) return cached;

  const tables: TableEntry[] = [];
  const byName = new Map<string, TableEntry[]>();
  let hasSensitive = false;

  const rawTables = schema.tables as unknown as LooseTable[];
  rawTables.forEach((t, order) => {
    const schemaName = typeof t.schema === "string" && t.schema !== "" ? t.schema : undefined;
    const tableSensitive = t.sensitive === true;
    if (tableSensitive) hasSensitive = true;
    const columns: ColumnEntry[] = (t.columns ?? []).map((c, ci) => {
      const sensitive = tableSensitive || c.sensitive === true;
      if (sensitive) hasSensitive = true;
      return { name: c.name, lower: c.name.toLowerCase(), sensitive, order: ci };
    });

    const entry: TableEntry = {
      name: t.name,
      ...(schemaName ? { schema: schemaName } : {}),
      lower: t.name.toLowerCase(),
      ...(schemaName ? { schemaLower: schemaName.toLowerCase() } : {}),
      sensitive: tableSensitive,
      order,
      columns,
      byColumn: new Map(columns.map((c) => [c.lower, c])),
    };
    tables.push(entry);
    const bucket = byName.get(entry.lower);
    if (bucket) bucket.push(entry);
    else byName.set(entry.lower, [entry]);
  });

  const index: SchemaIndex = { tables, byName, hasSensitive };
  indexCache.set(schema, index);
  return index;
}

// ---------------------------------------------------------------------------
// Tokens — adapted from the shared dialect-aware lexer
// ---------------------------------------------------------------------------

type TokKind = "word" | "punct" | "literal" | "placeholder" | "number";
type Tok = { kind: TokKind; value: string; lower: string; quoted: boolean };

/**
 * Map lexer tokens onto the scanner's simpler vocabulary. Comments are dropped (MySQL
 * `/*! … *\/` bodies are already lexed as code). A MySQL `"…"` string is treated as a
 * quoted identifier: under `ANSI_QUOTES` it is one, and over-reporting is the safe side.
 */
function toToks(tokens: readonly SqlToken[]): Tok[] {
  const out: Tok[] = [];
  for (const t of tokens) {
    switch (t.kind) {
      case "comment":
        break;
      case "word":
        out.push({ kind: "word", value: t.value, lower: t.lower, quoted: false });
        break;
      case "quoted_identifier":
        out.push({ kind: "word", value: t.value, lower: t.lower, quoted: true });
        break;
      case "string":
        if (t.quote === '"') {
          const inner = t.text.slice(1, t.unterminated ? undefined : -1);
          out.push({ kind: "word", value: inner, lower: inner.toLowerCase(), quoted: true });
        } else {
          out.push({ kind: "literal", value: "'", lower: "'", quoted: false });
        }
        break;
      case "number":
        out.push({ kind: "number", value: t.text, lower: t.lower, quoted: false });
        break;
      case "parameter":
        out.push({ kind: "placeholder", value: t.text, lower: t.lower, quoted: false });
        break;
      case "punct":
        out.push({ kind: "punct", value: t.text, lower: t.text, quoted: false });
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

/**
 * Words that can never be a relation alias. Deliberately broad — a wrongly-taken
 * "alias" would bind a qualifier to the wrong table.
 */
const ALIAS_STOP = new Set([
  "all", "and", "any", "as", "asc", "at", "between", "by", "case", "collate", "cross",
  "desc", "distinct", "else", "end", "escape", "except", "exists", "fetch", "filter",
  "first", "for", "from", "full", "group", "having", "ilike", "in", "inner", "intersect",
  "into", "is", "join", "last", "lateral", "left", "like", "limit", "natural", "next",
  "not", "null", "nulls", "offset", "on", "only", "or", "order", "outer", "over",
  "partition", "returning", "right", "rows", "select", "set", "similar", "some",
  "straight_join", "tablesample", "then", "union", "unknown", "using", "values", "when",
  "where", "window", "with", "within",
]);

/**
 * Words that are never plausible column names, so they are excluded from the
 * unqualified-candidate set. Deliberately *narrow* — words like `key`, `first`,
 * `time`, `filter`, or `rows` are real column names in real schemas and must stay
 * eligible so a sensitive column named `key` is still caught.
 */
const BARE_STOP = new Set([
  "and", "as", "asc", "between", "by", "case", "cross", "desc", "distinct", "else",
  "escape", "except", "exists", "false", "from", "group", "having", "ilike", "in",
  "inner", "intersect", "is", "join", "lateral", "like", "limit", "natural", "not",
  "null", "nulls", "offset", "on", "or", "order", "outer", "over", "partition",
  "recursive", "select", "then", "true", "union", "using", "when", "where", "with",
]);

const JOIN_MODIFIER = new Set([
  "inner", "left", "right", "full", "outer", "cross", "natural", "straight_join",
]);

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

type QualifiedRef = { qualifier: string; qualifierSchema?: string; column: string };
type StarRef = { qualifier: string; qualifierSchema?: string };

type Found = SensitiveReference & { tableOrder: number; columnOrder: number };

type ScanOutcome = {
  found: Map<string, Found>;
  issues: Set<SensitiveScopeIssue>;
  widened: boolean;
};

/**
 * Lex and scan. With a known dialect the statement is lexed once, the way that engine
 * reads it. Without one (or for an unrecognized id) the generic reading decides scope
 * issues, and references are unioned across every engine's reading that lexes cleanly —
 * so a column hidden from one reading by an engine-specific quote or comment rule (for
 * example MySQL `'\''` or Postgres `E'\''`) is still reported. Readings with an
 * unterminated token are skipped: the engine would reject that SQL outright.
 */
function scanSql(
  sql: string,
  index: SchemaIndex,
  dialect: Pick<DialectSpec, "id" | "backslashEscapes"> | undefined,
): SensitiveGuardrailResult {
  const profile = dialect ? lexerProfileFor(dialect) : undefined;
  if (profile) return finalize(scanTokens(lexSql(sql, profile), index));

  const primary = scanTokens(lexSql(sql, GENERIC_LEXER), index);
  for (const p of ENGINE_LEXER_PROFILES) {
    const tokens = lexSql(sql, p);
    if (hasUnterminatedToken(tokens)) continue;
    for (const [key, ref] of scanTokens(tokens, index).found) {
      const existing = primary.found.get(key);
      if (!existing) primary.found.set(key, ref);
      else if (ref.matchKind === "qualified") existing.matchKind = "qualified";
    }
  }
  return finalize(primary);
}

function finalize(outcome: ScanOutcome): SensitiveGuardrailResult {
  const references = [...outcome.found.values()]
    .sort((a, b) => a.tableOrder - b.tableOrder || a.columnOrder - b.columnOrder)
    .map(({ tableOrder: _tableOrder, columnOrder: _columnOrder, ...ref }) => ref);

  const unresolvedScope =
    outcome.issues.size > 0 ? buildScopeReport([...outcome.issues], outcome.widened) : undefined;

  return {
    passed: references.length === 0 && unresolvedScope === undefined,
    references,
    ...(unresolvedScope ? { unresolvedScope } : {}),
  };
}

/** Words after which a `*` is a select-list wildcard rather than multiplication. */
const STAR_LEADS = new Set(["select", "distinct", "all", "percent", "ties"]);

function scanTokens(lexed: readonly SqlToken[], index: SchemaIndex): ScanOutcome {
  const tokens = toToks(lexed);
  const isWord = (t: Tok | undefined): boolean => t?.kind === "word";
  const isPunct = (t: Tok | undefined, v: string): boolean => t?.kind === "punct" && t.value === v;
  const canAlias = (t: Tok | undefined): boolean =>
    t?.kind === "word" && (t.quoted || !ALIAS_STOP.has(t.lower));

  /** Token indices already accounted for as relation names or aliases. */
  const consumed = new Set<number>();
  /** Relation names that exist but are not schema tables (CTEs, derived tables). */
  const derived = new Set<string>();
  const sourcePaths: string[][] = [];
  const aliasDecls: Array<{ alias: string; path: string[] }> = [];
  let opaqueSource = false;
  let sawTableSource = false;

  const closeParenAfter = (open: number): number => {
    let depth = 0;
    for (let k = open; k < tokens.length; k++) {
      if (isPunct(tokens[k], "(")) depth++;
      else if (isPunct(tokens[k], ")")) {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  };
  const openParenBefore = (close: number): number => {
    let depth = 0;
    for (let k = close; k >= 0; k--) {
      if (isPunct(tokens[k], ")")) depth++;
      else if (isPunct(tokens[k], "(")) {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  };

  /**
   * True when the `*` at `i` is a select-list wildcard: `SELECT *`, `SELECT a, *`,
   * `SELECT DISTINCT *`, `SELECT DISTINCT ON (x) *`, `SELECT TOP 5 *`, `TOP (5) *`.
   * Not `count(*)` or multiplication. `EXISTS (SELECT * …)` returns no columns, so it
   * does not count.
   */
  const isSelectListStar = (i: number): boolean => {
    const prev = tokens[i - 1];
    if (!prev) return false;
    if (isPunct(prev, ",")) return true;
    if (isWord(prev) && !prev.quoted && STAR_LEADS.has(prev.lower)) {
      if (prev.lower !== "select") return true;
      return !(isPunct(tokens[i - 2], "(") && isWord(tokens[i - 3]) && tokens[i - 3]!.lower === "exists");
    }
    if (prev.kind === "number") return isWord(tokens[i - 2]) && tokens[i - 2]!.lower === "top";
    if (isPunct(prev, ")")) {
      const open = openParenBefore(i - 1);
      const lead = tokens[open - 1];
      if (!isWord(lead)) return false;
      if (lead!.lower === "top") return true;
      return lead!.lower === "on" && isWord(tokens[open - 2]) && tokens[open - 2]!.lower === "distinct";
    }
    return false;
  };

  /** Consume an optional `AS alias` / bare `alias`; returns the index after it. */
  const takeAlias = (start: number, register: (alias: string) => void): number => {
    let k = start;
    if (isWord(tokens[k]) && tokens[k]!.lower === "as" && isWord(tokens[k + 1])) {
      consumed.add(k);
      k++;
    }
    if (canAlias(tokens[k])) {
      register(tokens[k]!.lower);
      consumed.add(k);
      k++;
      // Optional derived-column alias list: `… AS t(a, b)`
      if (isPunct(tokens[k], "(")) {
        const close = closeParenAfter(k);
        if (close !== -1) {
          for (let x = k + 1; x < close; x++) if (isWord(tokens[x])) consumed.add(x);
          k = close + 1;
        }
      }
    }
    return k;
  };

  const parseTableRef = (start: number): number => {
    let j = start;
    while (isWord(tokens[j]) && (tokens[j]!.lower === "lateral" || tokens[j]!.lower === "only")) {
      consumed.add(j);
      j++;
    }
    // Derived table / parenthesized join. The body is deliberately not skipped: the
    // outer walk still visits its FROM/JOINs, so nested base tables land in scope too.
    if (isPunct(tokens[j], "(")) {
      const close = closeParenAfter(j);
      if (close === -1) return j + 1;
      sawTableSource = true;
      return takeAlias(close + 1, (alias) => derived.add(alias));
    }
    if (!canAlias(tokens[j])) {
      // e.g. the operand in `EXTRACT(YEAR FROM 1)` — not a relation name.
      return j;
    }
    const path: string[] = [];
    const pathIdx: number[] = [];
    let k = j;
    for (;;) {
      if (!isWord(tokens[k])) break;
      path.push(tokens[k]!.lower);
      pathIdx.push(k);
      k++;
      if (isPunct(tokens[k], ".")) {
        k++;
        continue;
      }
      break;
    }
    for (const x of pathIdx) consumed.add(x);
    if (isPunct(tokens[k], "(")) {
      // Table function / table-valued expression — its columns are not schema columns.
      opaqueSource = true;
      const close = closeParenAfter(k);
      return takeAlias(close === -1 ? k + 1 : close + 1, (alias) => derived.add(alias));
    }
    sawTableSource = true;
    sourcePaths.push(path);
    return takeAlias(k, (alias) => aliasDecls.push({ alias, path }));
  };

  // Pass A — resolve relation names, aliases, and CTE names.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "word" || t.quoted) continue;

    // `name AS (` / `name (cols) AS (` → CTE or named subquery.
    if (t.lower === "as" && isPunct(tokens[i + 1], "(")) {
      let back = i - 1;
      if (isPunct(tokens[back], ")")) back = openParenBefore(back) - 1;
      if (canAlias(tokens[back])) {
        derived.add(tokens[back]!.lower);
        consumed.add(back);
      }
      continue;
    }

    if (t.lower !== "from" && t.lower !== "join") continue;
    consumed.add(i);
    if (t.lower === "join") {
      for (let k = i - 1; k >= 0 && isWord(tokens[k]) && JOIN_MODIFIER.has(tokens[k]!.lower); k--) {
        consumed.add(k);
      }
    }
    let j = i + 1;
    for (;;) {
      const next = parseTableRef(j);
      // Old-style comma-separated FROM lists; JOIN takes exactly one reference.
      if (t.lower === "from" && next > j && isPunct(tokens[next], ",")) {
        j = next + 1;
        continue;
      }
      break;
    }
  }

  // Pass B — collect the column references the statement actually makes.
  const qualifiedRefs: QualifiedRef[] = [];
  const starRefs: StarRef[] = [];
  const bare = new Set<string>();
  let bareStar = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isPunct(t, "*") && isSelectListStar(i)) {
      bareStar = true;
      continue;
    }
    if (t.kind !== "word") continue;
    if (isPunct(tokens[i - 1], ".")) continue; // tail of a path, handled at its head
    if (isPunct(tokens[i - 1], "::")) continue; // cast target type
    if (isWord(tokens[i - 1]) && tokens[i - 1]!.lower === "as") continue; // output alias

    if (isPunct(tokens[i + 1], ".")) {
      const path: string[] = [t.lower];
      let k = i + 1;
      let star = false;
      while (isPunct(tokens[k], ".")) {
        k++;
        if (isPunct(tokens[k], "*")) {
          star = true;
          k++;
          break;
        }
        if (!isWord(tokens[k])) break;
        path.push(tokens[k]!.lower);
        k++;
      }
      if (star && !consumed.has(i)) {
        // `alias.*` / `schema.table.*` — every column of the qualifier's table.
        starRefs.push({
          qualifier: path[path.length - 1]!,
          ...(path.length >= 2 ? { qualifierSchema: path[path.length - 2]! } : {}),
        });
      } else if (!star && path.length >= 2 && !consumed.has(i)) {
        qualifiedRefs.push({
          column: path[path.length - 1]!,
          qualifier: path[path.length - 2]!,
          ...(path.length >= 3 ? { qualifierSchema: path[path.length - 3]! } : {}),
        });
      }
      i = k - 1;
      continue;
    }

    if (consumed.has(i)) continue;
    if (isPunct(tokens[i + 1], "(")) continue; // function call
    if (!t.quoted && BARE_STOP.has(t.lower)) continue;
    bare.add(t.lower);
  }

  // Bind relation names and aliases to schema tables.
  const resolve = (path: string[]): TableEntry[] => {
    const name = path[path.length - 1]!;
    const qualifier = path.length >= 2 ? path[path.length - 2] : undefined;
    const candidates = index.byName.get(name) ?? [];
    if (!qualifier) return candidates;
    const exact = candidates.filter((e) => e.schemaLower === qualifier);
    if (exact.length > 0) return exact;
    // v1 schemas carry no namespace — a qualified reference still matches by name.
    return candidates.filter((e) => e.schemaLower === undefined);
  };

  const inScope = new Set<TableEntry>();
  const qualifiers = new Map<string, TableEntry[]>();
  const bindQualifier = (name: string, entries: TableEntry[]): void => {
    const bucket = qualifiers.get(name);
    if (bucket) bucket.push(...entries.filter((e) => !bucket.includes(e)));
    else qualifiers.set(name, [...entries]);
  };
  for (const path of sourcePaths) {
    const entries = resolve(path);
    for (const e of entries) inScope.add(e);
    bindQualifier(path[path.length - 1]!, entries);
  }
  for (const decl of aliasDecls) bindQualifier(decl.alias, resolve(decl.path));

  // Collect findings.
  const found = new Map<string, Found>();
  const record = (
    table: TableEntry,
    column: string,
    columnOrder: number,
    matchKind: SensitiveMatchKind,
  ): void => {
    const key = `${table.schemaLower ?? ""}.${table.lower}.${column.toLowerCase()}`;
    const existing = found.get(key);
    if (existing) {
      // A qualified hit is the stronger explanation of the same reference.
      if (matchKind === "qualified") existing.matchKind = "qualified";
      return;
    }
    found.set(key, {
      table: table.name,
      ...(table.schema ? { schema: table.schema } : {}),
      column,
      matchKind,
      tableOrder: table.order,
      columnOrder,
    });
  };

  // Sensitive tables reached as a FROM/JOIN target — catches `SELECT * FROM secrets`.
  for (const table of inScope) {
    if (table.sensitive) record(table, "*", -1, "table");
  }

  const issues = new Set<SensitiveScopeIssue>();
  if (opaqueSource) issues.add("OPAQUE_TABLE_SOURCE");

  // Qualified references.
  const unknownQualifierColumns = new Set<string>();
  for (const ref of qualifiedRefs) {
    const bound = qualifiers.get(ref.qualifier);
    if (!bound) {
      if (derived.has(ref.qualifier)) continue; // CTE / derived relation — a known namespace
      issues.add("UNKNOWN_QUALIFIER");
      unknownQualifierColumns.add(ref.column);
      continue;
    }
    const scoped = ref.qualifierSchema
      ? bound.filter((e) => e.schemaLower === undefined || e.schemaLower === ref.qualifierSchema)
      : bound;
    for (const table of scoped) {
      const column = table.byColumn.get(ref.column);
      if (column?.sensitive) record(table, column.name, column.order, "qualified");
    }
  }

  // Unqualified references — counted only when the owning table is in scope.
  const noTableSource = !sawTableSource && bare.size > 0;
  if (noTableSource) issues.add("NO_TABLE_SOURCE");
  const bareScope = noTableSource ? index.tables : [...inScope];
  for (const table of bareScope) {
    for (const column of table.columns) {
      if (column.sensitive && bare.has(column.lower)) {
        record(table, column.name, column.order, "unqualified");
      }
    }
  }
  // A qualifier we could not bind: its column could belong to anything, so match it
  // against every sensitive column rather than drop it.
  if (unknownQualifierColumns.size > 0) {
    for (const table of index.tables) {
      for (const column of table.columns) {
        if (column.sensitive && unknownQualifierColumns.has(column.lower)) {
          record(table, column.name, column.order, "unqualified");
        }
      }
    }
  }

  // Wildcards and whole-row references reach every column of the table, so they reach
  // its sensitive columns. (Table-level-sensitive tables are already reported as "*".)
  const recordAllSensitive = (table: TableEntry, matchKind: SensitiveMatchKind): void => {
    if (table.sensitive) return;
    for (const column of table.columns) {
      if (column.sensitive) record(table, column.name, column.order, matchKind);
    }
  };
  // Bare `SELECT *` — every in-scope table.
  if (bareStar) {
    for (const table of inScope) recordAllSensitive(table, "unqualified");
  }
  // `alias.*`
  for (const ref of starRefs) {
    const bound = qualifiers.get(ref.qualifier);
    if (!bound) {
      if (!derived.has(ref.qualifier)) issues.add("UNKNOWN_QUALIFIER");
      continue;
    }
    const scoped = ref.qualifierSchema
      ? bound.filter((e) => e.schemaLower === undefined || e.schemaLower === ref.qualifierSchema)
      : bound;
    for (const table of scoped) recordAllSensitive(table, "qualified");
  }
  // A table name or alias used as a value — `row_to_json(u)`, `to_jsonb(u)`,
  // `json_agg(u)`, Postgres `SELECT u FROM users u` — is the whole row.
  for (const word of bare) {
    for (const table of qualifiers.get(word) ?? []) recordAllSensitive(table, "qualified");
  }

  if (lexed.some((t) => t.unterminated)) issues.add("UNTERMINATED_TOKEN");

  return { found, issues, widened: noTableSource || unknownQualifierColumns.size > 0 };
}

const SCOPE_ISSUE_TEXT: Record<SensitiveScopeIssue, string> = {
  NO_TABLE_SOURCE:
    "no FROM/JOIN target could be resolved, so unqualified column names cannot be bound to a table",
  UNKNOWN_QUALIFIER:
    "a qualified reference used a qualifier that is not a known table, alias, or CTE",
  OPAQUE_TABLE_SOURCE:
    "a table source is not a relation name (table function or table-valued expression)",
  UNTERMINATED_TOKEN:
    "a string, quoted identifier, or comment never closes, so the rest of the statement could not be scanned",
};

function buildScopeReport(issues: SensitiveScopeIssue[], widened: boolean): SensitiveScopeReport {
  const detail = issues.map((i) => SCOPE_ISSUE_TEXT[i]).join("; ");
  return {
    issues,
    widened,
    message:
      `Could not resolve the statement's table scope: ${detail}.` +
      (widened
        ? " Unqualified names were matched against every sensitive column in the schema, so some references may be over-reported."
        : ""),
  };
}

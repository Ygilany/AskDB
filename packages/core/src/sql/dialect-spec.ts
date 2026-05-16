/**
 * `DialectSpec` — a small descriptor each SQL engine supplies so the centralized
 * NL→SQL pipeline (in this package) can generate dialect-correct SELECT queries
 * without each integration package re-implementing the prompt / validator.
 *
 * Authoring guidance:
 *   - Keep `promptBrief` to one short paragraph; surfaced in the model's user prompt.
 *   - `extraForbiddenKeywords` is additive on top of the dialect-agnostic read-only
 *     denylist (`insert`, `update`, `delete`, `drop`, …) baked into `validateSelectSql`.
 *   - `extraValidate` runs *after* the base validator passes; throw a
 *     `SqlValidationError` to reject dialect-specific shapes.
 */

/** Stable identifier for a built-in dialect. Connectors may surface this via `IntrospectionResult.provider`. */
export type DialectId =
  | "postgres"
  | "cockroachdb"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "sqlserver";

export type DialectSpec = {
  id: DialectId;
  displayName: string;
  /** One short paragraph injected into the NL→SQL user prompt. */
  promptBrief: string;
  /** Identifier quoting style — informational; mainly steers `promptBrief`. */
  identifierQuote: '"' | '`';
  /** Extra keywords to forbid on top of the dialect-agnostic base denylist. */
  extraForbiddenKeywords?: readonly string[];
  /** Optional engine-specific post-validator. Receives SQL already passing the base shape checks. */
  extraValidate?: (sql: string) => void;
};

/** PostgreSQL — the original AskDB target. */
export const POSTGRES_DIALECT: DialectSpec = {
  id: "postgres",
  displayName: "PostgreSQL",
  promptBrief:
    "Target PostgreSQL. Use ILIKE for case-insensitive matching. " +
    "Quote identifiers with double quotes when they collide with keywords or contain mixed case. " +
    'Cast with `value::type`. Use NOW(), CURRENT_DATE, date_trunc(). Concatenate with `||`.',
  identifierQuote: '"',
};

/** CockroachDB — PostgreSQL-wire-compatible; reuses the Postgres prompt brief. */
export const COCKROACHDB_DIALECT: DialectSpec = {
  ...POSTGRES_DIALECT,
  id: "cockroachdb",
  displayName: "CockroachDB",
};

/**
 * Registry of dialect specs shipped with `@askdb/core`. Additional dialects
 * (MySQL, MariaDB, SQLite, SQL Server) are planned but require validated
 * prompt briefs and are not yet bundled — connectors that detect them will
 * raise a clear error directing the user to set `askdb.config.dialect`.
 */
export const BUILT_IN_DIALECTS = {
  postgres: POSTGRES_DIALECT,
  cockroachdb: COCKROACHDB_DIALECT,
} as const satisfies Partial<Record<DialectId, DialectSpec>>;

export type BuiltInDialectId = keyof typeof BUILT_IN_DIALECTS;

export const SUPPORTED_DIALECT_IDS: readonly BuiltInDialectId[] = Object.keys(
  BUILT_IN_DIALECTS,
) as readonly BuiltInDialectId[];

export function isBuiltInDialectId(value: unknown): value is BuiltInDialectId {
  return typeof value === "string" && value in BUILT_IN_DIALECTS;
}

/**
 * Look up a built-in dialect by id. Throws when no spec ships for the id —
 * tell callers (e.g. Prisma auto-detection) to surface a helpful "set
 * `config.dialect` explicitly" message in that case.
 */
export function getDialectSpec(id: BuiltInDialectId): DialectSpec {
  const spec = BUILT_IN_DIALECTS[id];
  if (!spec) {
    throw new Error(
      `No DialectSpec is registered for '${id}'. Supported: ${SUPPORTED_DIALECT_IDS.join(", ")}.`,
    );
  }
  return spec;
}

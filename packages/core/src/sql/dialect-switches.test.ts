/**
 * #661: every built-in dialect id has its own lexer profile, quoting, marker style,
 * SELECT modifiers and tenant reading. Each check loops over `SUPPORTED_DIALECT_IDS`,
 * so adding a built-in id fails here until every switch has a case for it.
 *
 * The deliberate fail-closed defaults are covered too: an id that is no built-in
 * engine gets no lexer profile, and with no dialect every engine's SELECT modifiers
 * apply, so no wildcard slips past.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedSchema } from "../schema/types.js";
import { markerStyleForDialect, type MarkerStyle } from "./bind.js";
import {
  getDialectSpec,
  SUPPORTED_DIALECT_IDS,
  type BuiltInDialectId,
  type DialectSpec,
} from "./dialect-spec.js";
import { lexerProfileFor, type SqlLexerProfileId } from "./lexer.js";
import { promptIdentifierQuoter } from "./prompt-identifiers.js";
import { tenantCodeReadings } from "./readings.js";
import { validateSensitiveReferences } from "./sensitive-guardrail.js";

/** The lexer family each built-in id reads as. */
const LEXER_PROFILE: Record<BuiltInDialectId, SqlLexerProfileId> = {
  postgres: "postgres",
  cockroachdb: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  sqlserver: "sqlserver",
};

/** How each id quotes a name that must be quoted. */
const QUOTING: Record<BuiltInDialectId, { open: string; close: string }> = {
  postgres: { open: '"', close: '"' },
  cockroachdb: { open: '"', close: '"' },
  mysql: { open: "`", close: "`" },
  mariadb: { open: "`", close: "`" },
  sqlite: { open: '"', close: '"' },
  sqlserver: { open: "[", close: "]" },
};

/** The driver marker style each id binds with. */
const MARKER_STYLE: Record<BuiltInDialectId, MarkerStyle> = {
  postgres: "dollar",
  cockroachdb: "dollar",
  mysql: "question",
  mariadb: "question",
  sqlite: "question",
  sqlserver: "atp",
};

/** The tenant check's predicate-reading profile each id gets. */
const TENANT_READING: Record<BuiltInDialectId, SqlLexerProfileId> = {
  postgres: "postgres",
  cockroachdb: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "generic",
  sqlserver: "sqlserver",
};

/**
 * A `SELECT … *` that is a bare wildcard only under one engine family's SELECT
 * modifiers: Postgres `DISTINCT ON (…)`, MySQL `SQL_NO_CACHE`, SQL Server `TOP n`.
 */
const FAMILY_PROBE = {
  postgres: "SELECT DISTINCT ON (id) * FROM users",
  mysql: "SELECT SQL_NO_CACHE * FROM users",
  sqlserver: "SELECT TOP 1 * FROM users",
} as const;

/** The `SELECT … *` that is a bare wildcard under this id's modifiers. */
const MODIFIER_PROBE: Record<BuiltInDialectId, string> = {
  postgres: FAMILY_PROBE.postgres,
  cockroachdb: FAMILY_PROBE.postgres,
  mysql: FAMILY_PROBE.mysql,
  mariadb: FAMILY_PROBE.mysql,
  sqlite: "SELECT DISTINCT * FROM users",
  sqlserver: FAMILY_PROBE.sqlserver,
};

/** Which family probe belongs to this id (`undefined` when it has no family-only one). */
const FAMILY_OF: Record<BuiltInDialectId, keyof typeof FAMILY_PROBE | undefined> = {
  postgres: "postgres",
  cockroachdb: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: undefined,
  sqlserver: "sqlserver",
};

const schema: NormalizedSchema = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "email", type: "text", nullable: false, sensitive: true },
      ],
    },
  ],
};

describe("dialect switches are exhaustive over BuiltInDialectId (#661)", () => {
  it.each([...SUPPORTED_DIALECT_IDS])("the %s id has its own lexer profile", (id) => {
    // The row must exist: a new id with no row here fails, not passes vacuously.
    const expected = LEXER_PROFILE[id];
    expect(expected).toBeDefined();
    const profile = lexerProfileFor(getDialectSpec(id));
    expect(profile).toBeDefined();
    expect(profile?.id).toBe(expected);
  });

  it.each([...SUPPORTED_DIALECT_IDS])("the %s id quotes with its own delimiters", (id) => {
    const quoting = QUOTING[id];
    expect(quoting).toBeDefined();
    const quote = promptIdentifierQuoter(getDialectSpec(id));
    const { open, close } = quoting!;
    expect(quote("my table")).toBe(`${open}my table${close}`);
  });

  it.each([...SUPPORTED_DIALECT_IDS])("the %s id has its own marker style", (id) => {
    const expected = MARKER_STYLE[id];
    expect(expected).toBeDefined();
    expect(markerStyleForDialect(id)).toBe(expected);
  });

  it.each([...SUPPORTED_DIALECT_IDS])("the %s id has its own tenant reading", (id) => {
    const expected = TENANT_READING[id];
    expect(expected).toBeDefined();
    const profiles = tenantCodeReadings(getDialectSpec(id)).map((reading) => reading.profile.id);
    expect(profiles).toContain(expected);
  });

  it.each([...SUPPORTED_DIALECT_IDS])("the %s id reads its own SELECT modifiers", (id) => {
    const probe = MODIFIER_PROBE[id];
    expect(probe).toBeDefined();
    // Its own probe is a bare wildcard, so the sensitive column is reported.
    const own = validateSensitiveReferences(probe!, schema, { dialect: getDialectSpec(id) });
    expect(own.references).toContainEqual(expect.objectContaining({ table: "users", column: "email" }));
    // Every other family's probe is not a bare wildcard here, so nothing is reported.
    for (const family of Object.keys(FAMILY_PROBE) as Array<keyof typeof FAMILY_PROBE>) {
      if (family === FAMILY_OF[id]) continue;
      const result = validateSensitiveReferences(FAMILY_PROBE[family], schema, { dialect: getDialectSpec(id) });
      expect(result.references, `${FAMILY_PROBE[family]} under ${id}`).toEqual([]);
    }
  });

  it("returns no lexer profile for an id that is no built-in engine", () => {
    expect(
      lexerProfileFor({ id: "snowflake", backslashEscapes: false } as unknown as DialectSpec),
    ).toBeUndefined();
  });

  it("reads every engine's view when no dialect is given", () => {
    const profiles = tenantCodeReadings(undefined).map((reading) => reading.profile.id);
    expect(profiles).toEqual(expect.arrayContaining(["generic", "postgres", "mysql", "sqlserver"]));
  });

  it("with no dialect, every engine's SELECT modifiers apply, so no wildcard slips past", () => {
    for (const sql of Object.values(FAMILY_PROBE)) {
      const result = validateSensitiveReferences(sql, schema);
      expect(result.references).toContainEqual(expect.objectContaining({ table: "users", column: "email" }));
    }
  });
});

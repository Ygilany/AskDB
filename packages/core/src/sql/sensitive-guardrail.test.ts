import { describe, expect, it } from "vitest";
import { SensitiveReferenceError } from "../errors.js";
import type { NormalizedSchema } from "../schema/types.js";
import type { NormalizedSchemaV2, NormalizedV2Table } from "../schema/v2/normalized.js";
import { validateSensitiveReferences, schemaHasSensitiveIdentifiers } from "./sensitive-guardrail.js";

// ---------------------------------------------------------------------------
// Fixture: the Postgres schema from the false-positive report — two Liquibase
// changelog tables marked sensitive at table level, both with an `id` column.
// ---------------------------------------------------------------------------

function table(
  schema: string,
  name: string,
  columns: Array<[name: string, sensitive?: boolean]>,
  sensitive = false,
): NormalizedV2Table {
  return {
    id: `table:${schema}.${name}`,
    name,
    schema,
    sensitive,
    columns: columns.map(([columnName, columnSensitive]) => ({
      id: `table:${schema}.${name}#${columnName}`,
      name: columnName,
      type: "text",
      nullable: true,
      primaryKey: columnName === "id",
      sensitive: columnSensitive === true,
    })),
  };
}

const districtSchema: NormalizedSchemaV2 = {
  schemaId: "district",
  warnings: [],
  tables: [
    table("people", "students", [["id"], ["first_name"], ["last_name"], ["deleted_at"]]),
    table("services", "notes", [["id"], ["service_date"], ["student_id"], ["body"]]),
    table("identity", "users", [["id"], ["email"], ["password", true], ["tag"]]),
    table(
      "public",
      "databasechangelog",
      [["id"], ["author"], ["filename"], ["description"], ["tag"]],
      true,
    ),
    table("public", "databasechangeloglock", [["id"], ["locked"], ["lockedby"]], true),
  ],
};

const v1Schema: NormalizedSchema = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "email", type: "text", nullable: false },
        { name: "secret_recovery_token", type: "text", nullable: false, sensitive: true },
      ],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "total_cents", type: "integer", nullable: false },
      ],
    },
  ],
};

describe("validateSensitiveReferences — qualified matches", () => {
  it("flags a sensitive column referenced as table.column", () => {
    const result = validateSensitiveReferences(
      "SELECT identity.users.password FROM identity.users",
      districtSchema,
    );
    expect(result.passed).toBe(false);
    expect(result.references).toContainEqual({
      table: "users",
      schema: "identity",
      column: "password",
      matchKind: "qualified",
    });
  });

  it("resolves alias-bound references (FROM identity.users u … u.password)", () => {
    const result = validateSensitiveReferences(
      "SELECT u.email, u.password FROM identity.users u WHERE u.id = 1",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "qualified" },
    ]);
    expect(result.unresolvedScope).toBeUndefined();
  });

  it("resolves AS-form aliases", () => {
    const result = validateSensitiveReferences(
      "SELECT usr.password FROM identity.users AS usr",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "qualified" },
    ]);
  });

  it("does not flag an alias bound to a different table", () => {
    const result = validateSensitiveReferences(
      "SELECT s.first_name FROM people.students s JOIN identity.users u ON u.id = s.id",
      districtSchema,
    );
    // `users` is sensitive only at column level and `password` is never named.
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("validateSensitiveReferences — unqualified matches", () => {
  it("flags a bare column when the owning table IS in scope", () => {
    const result = validateSensitiveReferences(
      "SELECT email, password FROM identity.users",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "unqualified" },
    ]);
  });

  it("flags a bare column when the owning table is reached by JOIN", () => {
    const result = validateSensitiveReferences(
      `SELECT n.service_date, password
         FROM services.notes n
         JOIN identity.users u ON u.id = n.student_id`,
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "unqualified" },
    ]);
  });

  it("does NOT flag a bare column when the owning table is not in scope", () => {
    const result = validateSensitiveReferences(
      "SELECT email FROM services.notes",
      districtSchema,
    );
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("validateSensitiveReferences — the `id` regression", () => {
  // Reported against a real Postgres schema: two table-level-sensitive Liquibase
  // changelog tables promoted every generic column (`id`, `tag`, `description`)
  // into the match set, so the old bare-word matcher flagged every benign query.
  it("does not flag databasechangelog.id for an unrelated students query", () => {
    const result = validateSensitiveReferences(
      "SELECT s.id, s.first_name, s.last_name FROM people.students s WHERE s.deleted_at IS NULL",
      districtSchema,
    );
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("does not flag databasechangelog.id for an unrelated notes/students join", () => {
    const result = validateSensitiveReferences(
      "SELECT n.id, n.service_date FROM services.notes n JOIN people.students st ON st.id = n.student_id",
      districtSchema,
    );
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("still flags users.password — the one correct result of the three", () => {
    const result = validateSensitiveReferences(
      "SELECT email, password FROM identity.users",
      districtSchema,
    );
    expect(result.references.map((r) => `${r.schema}.${r.table}.${r.column}`)).toEqual([
      "identity.users.password",
    ]);
  });

  it("flags the same bare `id` once the sensitive table IS in scope", () => {
    const result = validateSensitiveReferences(
      "SELECT id, filename FROM public.databasechangelog",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "databasechangelog", schema: "public", column: "*", matchKind: "table" },
      { table: "databasechangelog", schema: "public", column: "id", matchKind: "unqualified" },
      { table: "databasechangelog", schema: "public", column: "filename", matchKind: "unqualified" },
    ]);
  });
});

describe("validateSensitiveReferences — table-level sensitive", () => {
  it("flags a sensitive table reached as a FROM target even with SELECT *", () => {
    const result = validateSensitiveReferences(
      "SELECT * FROM public.databasechangeloglock",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "databasechangeloglock", schema: "public", column: "*", matchKind: "table" },
    ]);
    expect(result.passed).toBe(false);
  });

  it("flags a sensitive table reached by JOIN", () => {
    const result = validateSensitiveReferences(
      `SELECT s.first_name
         FROM people.students s
         LEFT JOIN public.databasechangelog dcl ON dcl.id = s.id`,
      districtSchema,
    );
    expect(result.references).toContainEqual({
      table: "databasechangelog",
      schema: "public",
      column: "*",
      matchKind: "table",
    });
  });

  it("does not let generic column names of a sensitive table leak into other queries", () => {
    // `tag` exists on both identity.users (not sensitive) and databasechangelog (sensitive).
    const result = validateSensitiveReferences("SELECT tag FROM identity.users", districtSchema);
    expect(result.references).toEqual([]);
  });
});

describe("validateSensitiveReferences — string literals and quoting", () => {
  it("ignores a sensitive name that appears only inside a string literal", () => {
    const result = validateSensitiveReferences(
      "SELECT s.first_name FROM people.students s WHERE s.last_name = 'password'",
      districtSchema,
    );
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("ignores a sensitive table name inside a string literal", () => {
    const result = validateSensitiveReferences(
      "SELECT s.id FROM people.students s WHERE s.first_name = 'databasechangelog'",
      districtSchema,
    );
    expect(result.references).toEqual([]);
  });

  it("ignores sensitive names inside SQL comments", () => {
    const result = validateSensitiveReferences(
      "SELECT s.id FROM people.students s -- password lives on identity.users\n",
      districtSchema,
    );
    expect(result.references).toEqual([]);
  });

  it("matches double-quoted identifiers", () => {
    const result = validateSensitiveReferences(
      'SELECT u."password" FROM "identity"."users" u',
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "qualified" },
    ]);
  });

  it("ignores an output alias that happens to match a sensitive column name", () => {
    const result = validateSensitiveReferences(
      "SELECT s.first_name AS password FROM people.students s",
      districtSchema,
    );
    expect(result.references).toEqual([]);
  });
});

describe("validateSensitiveReferences — CTEs and subqueries", () => {
  it("sees base tables inside a CTE", () => {
    const result = validateSensitiveReferences(
      `WITH recent AS (SELECT u.id, u.password FROM identity.users u)
       SELECT recent.id FROM recent`,
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "qualified" },
    ]);
    expect(result.unresolvedScope).toBeUndefined();
  });

  it("does not treat a CTE name as an unknown qualifier", () => {
    const result = validateSensitiveReferences(
      `WITH roster AS (SELECT s.id, s.first_name FROM people.students s)
       SELECT roster.first_name FROM roster`,
      districtSchema,
    );
    expect(result.passed).toBe(true);
    expect(result.unresolvedScope).toBeUndefined();
  });

  it("sees base tables inside a derived table", () => {
    const result = validateSensitiveReferences(
      "SELECT sub.n FROM (SELECT count(*) AS n FROM public.databasechangelog) sub",
      districtSchema,
    );
    expect(result.references).toEqual([
      { table: "databasechangelog", schema: "public", column: "*", matchKind: "table" },
    ]);
  });
});

describe("validateSensitiveReferences — unresolvable scope", () => {
  it("widens and reports when there is no resolvable table source", () => {
    const result = validateSensitiveReferences("SELECT password", districtSchema);
    expect(result.passed).toBe(false);
    expect(result.unresolvedScope?.issues).toEqual(["NO_TABLE_SOURCE"]);
    expect(result.unresolvedScope?.widened).toBe(true);
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "unqualified" },
    ]);
  });

  it("widens and reports when a qualifier binds to nothing known", () => {
    const result = validateSensitiveReferences("SELECT u.password", districtSchema);
    expect(result.unresolvedScope?.issues).toEqual(["UNKNOWN_QUALIFIER"]);
    expect(result.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "unqualified" },
    ]);
  });

  it("reports an opaque table source without widening", () => {
    const result = validateSensitiveReferences(
      "SELECT s.first_name, g FROM people.students s, generate_series(1, 3) g",
      districtSchema,
    );
    expect(result.unresolvedScope?.issues).toEqual(["OPAQUE_TABLE_SOURCE"]);
    expect(result.unresolvedScope?.widened).toBe(false);
    // No widening: databasechangelog.id is not dragged in.
    expect(result.references).toEqual([]);
    expect(result.passed).toBe(false);
  });

  it("does not flag scope issues for a constant-only statement", () => {
    const result = validateSensitiveReferences("SELECT 1", districtSchema);
    expect(result.passed).toBe(true);
    expect(result.unresolvedScope).toBeUndefined();
  });

  it("does not flag an alias bound to a table outside the schema", () => {
    const result = validateSensitiveReferences(
      "SELECT lt.password FROM legacy_thing lt",
      districtSchema,
    );
    expect(result.references).toEqual([]);
    expect(result.unresolvedScope).toBeUndefined();
  });
});

describe("validateSensitiveReferences — modes", () => {
  const sql = "SELECT email, password FROM identity.users";

  it("warn mode returns references without throwing (default)", () => {
    const result = validateSensitiveReferences(sql, districtSchema);
    expect(result.passed).toBe(false);
    expect(result.references).toHaveLength(1);
  });

  it("warn mode is the default when no options are supplied", () => {
    expect(() => validateSensitiveReferences(sql, districtSchema)).not.toThrow();
    expect(() => validateSensitiveReferences(sql, districtSchema, {})).not.toThrow();
    expect(() => validateSensitiveReferences(sql, districtSchema, { mode: "warn" })).not.toThrow();
  });

  it("strict mode throws SensitiveReferenceError carrying the references", () => {
    let thrown: unknown;
    try {
      validateSensitiveReferences(sql, districtSchema, { mode: "strict" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SensitiveReferenceError);
    const error = thrown as SensitiveReferenceError;
    expect(error.rule).toBe("SENSITIVE_COLUMN_REFERENCED");
    expect(error.references).toEqual([
      { table: "users", schema: "identity", column: "password", matchKind: "unqualified" },
    ]);
    expect(error.message).toContain("identity.users.password");
  });

  it("strict mode uses SENSITIVE_TABLE_REFERENCED when a whole table is hit", () => {
    expect(() =>
      validateSensitiveReferences("SELECT * FROM public.databasechangelog", districtSchema, {
        mode: "strict",
      }),
    ).toThrow(/SENSITIVE|sensitive/);
    try {
      validateSensitiveReferences("SELECT * FROM public.databasechangelog", districtSchema, {
        mode: "strict",
      });
    } catch (error) {
      expect((error as SensitiveReferenceError).rule).toBe("SENSITIVE_TABLE_REFERENCED");
    }
  });

  it("strict mode throws UNRESOLVED_TABLE_SCOPE when scope cannot be proven", () => {
    try {
      validateSensitiveReferences(
        "SELECT s.first_name FROM people.students s, generate_series(1, 3) g",
        districtSchema,
        { mode: "strict" },
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SensitiveReferenceError);
      expect((error as SensitiveReferenceError).rule).toBe("UNRESOLVED_TABLE_SCOPE");
      expect((error as SensitiveReferenceError).unresolvedScope?.issues).toEqual([
        "OPAQUE_TABLE_SOURCE",
      ]);
    }
  });

  it("strict mode does not throw on a clean statement", () => {
    expect(() =>
      validateSensitiveReferences(
        "SELECT s.id, s.first_name FROM people.students s",
        districtSchema,
        { mode: "strict" },
      ),
    ).not.toThrow();
  });
});

describe("validateSensitiveReferences — v1 schemas", () => {
  it("matches unqualified sensitive columns against in-scope tables", () => {
    const result = validateSensitiveReferences(
      "SELECT id, secret_recovery_token FROM users",
      v1Schema,
    );
    expect(result.references).toEqual([
      { table: "users", column: "secret_recovery_token", matchKind: "unqualified" },
    ]);
  });

  it("does not flag a query against an unrelated table", () => {
    const result = validateSensitiveReferences("SELECT id, total_cents FROM orders", v1Schema);
    expect(result.passed).toBe(true);
  });

  it("matches a schema-qualified reference even though v1 has no namespace", () => {
    const result = validateSensitiveReferences(
      "SELECT u.secret_recovery_token FROM public.users u",
      v1Schema,
    );
    expect(result.references).toEqual([
      { table: "users", column: "secret_recovery_token", matchKind: "qualified" },
    ]);
  });
});

describe("schemaHasSensitiveIdentifiers", () => {
  it("is true when any marker exists", () => {
    expect(schemaHasSensitiveIdentifiers(districtSchema)).toBe(true);
    expect(schemaHasSensitiveIdentifiers(v1Schema)).toBe(true);
  });

  it("is false for a schema with no markers, and the guardrail short-circuits", () => {
    const clean: NormalizedSchema = {
      tables: [
        {
          name: "users",
          columns: [{ name: "password", type: "text", nullable: false, primaryKey: false }],
        },
      ],
    };
    expect(schemaHasSensitiveIdentifiers(clean)).toBe(false);
    const result = validateSensitiveReferences("SELECT password FROM users", clean, {
      mode: "strict",
    });
    expect(result).toEqual({ passed: true, references: [] });
  });
});

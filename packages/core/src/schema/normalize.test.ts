import { describe, expect, it } from "vitest";
import { loadNormalizedSchemaFromJson } from "./parse.js";
import { formatSchemaForNlToSql } from "./normalize.js";

describe("formatSchemaForNlToSql (sensitive-field plumbing)", () => {
  it("withholds an entire sensitive table without listing column names", () => {
    const schema = loadNormalizedSchemaFromJson(
      JSON.stringify({
        version: 1,
        tables: [
          {
            name: "public_users",
            columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }],
          },
          {
            name: "audit_private",
            sensitive: true,
            columns: [
              { name: "ssn_like_col", type: "text", nullable: false },
              { name: "other_secret", type: "text", nullable: false },
            ],
          },
        ],
      }),
    );
    const { ddl, stats } = formatSchemaForNlToSql(schema, {
      omitSensitiveIdentifiersFromPrompt: true,
    });
    expect(ddl).not.toMatch(/ssn_like_col|other_secret/);
    expect(ddl).toContain("sensitive table");
    expect(ddl).toContain("TABLE audit_private");
    expect(stats.redactedColumnCount).toBe(2);
    expect(stats.sensitiveTableStubCount).toBe(1);
  });

  it("lists sensitive-table columns with (sensitive) when not omitting", () => {
    const schema = loadNormalizedSchemaFromJson(
      JSON.stringify({
        version: 1,
        tables: [
          {
            name: "audit_private",
            sensitive: true,
            columns: [
              { name: "ssn_like_col", type: "text", nullable: false },
              { name: "other_secret", type: "text", nullable: false },
            ],
          },
        ],
      }),
    );
    const { ddl, stats } = formatSchemaForNlToSql(schema);
    const lines = ddl.split("\n");
    expect(lines.find((l) => l.includes("ssn_like_col"))).toMatch(/\(sensitive\)$/);
    expect(lines.find((l) => l.includes("other_secret"))).toMatch(/\(sensitive\)$/);
    expect(stats.listedSensitiveColumnCount).toBe(2);
  });
});

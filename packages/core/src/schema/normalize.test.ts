import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadNormalizedSchemaFromJson } from "./parse.js";
import { formatSchemaForNlToSql } from "./normalize.js";

const here = dirname(fileURLToPath(import.meta.url));
const sensitiveFixture = join(here, "../../../../fixtures/schemas/orders-users-sensitive.schema.json");

describe("formatSchemaForNlToSql (sensitive-field plumbing)", () => {
  it("by default lists sensitive columns with (sensitive) for SQL grounding", () => {
    const raw = readFileSync(sensitiveFixture, "utf8");
    const schema = loadNormalizedSchemaFromJson(raw);
    const { ddl, stats } = formatSchemaForNlToSql(schema);

    expect(ddl).toMatch(/secret_recovery_token/i);
    expect(ddl).toContain("(sensitive)");
    expect(ddl).toContain("email");
    expect(ddl).toContain("TABLE users");
    expect(ddl).toContain("TABLE orders");
    expect(stats.omitSensitiveIdentifiersFromPrompt).toBe(false);
    expect(stats.listedSensitiveColumnCount).toBe(1);
    expect(stats.redactedColumnCount).toBe(0);
  });

  it("omits sensitive identifiers when omitSensitiveIdentifiersFromPrompt is set", () => {
    const raw = readFileSync(sensitiveFixture, "utf8");
    const schema = loadNormalizedSchemaFromJson(raw);
    const { ddl, stats } = formatSchemaForNlToSql(schema, {
      omitSensitiveIdentifiersFromPrompt: true,
    });

    expect(ddl).not.toMatch(/secret_recovery_token/i);
    expect(stats.omitSensitiveIdentifiersFromPrompt).toBe(true);
    expect(stats.redactedColumnCount).toBe(1);
    expect(stats.listedSensitiveColumnCount).toBe(0);
  });

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
    expect(ddl).toMatch(/ssn_like_col|other_secret/);
    expect(stats.listedSensitiveColumnCount).toBe(2);
  });
});

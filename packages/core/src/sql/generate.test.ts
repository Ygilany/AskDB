import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedSchema } from "../schema/types.js";
import { SqlValidationError } from "../errors.js";
import { generatePostgresSelectSql } from "./generate.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

describe("generatePostgresSelectSql", () => {
  it("parses fenced SQL and validates SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const sql = await generatePostgresSelectSql("list users", minimalSchema, fakeModel, {
      generateText,
    });
    expect(sql).toBe("SELECT id FROM users");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("surfaces SqlValidationError when model returns non-SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nDELETE FROM users\n```",
    }));
    await expect(
      generatePostgresSelectSql("nuke", minimalSchema, fakeModel, {
        generateText,
      }),
    ).rejects.toThrow(SqlValidationError);
  });
});

import type { LanguageModel } from "ai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { NormalizedSchema } from "../schema/types.js";
import { loadNormalizedSchemaFromJson } from "../schema/parse.js";
import { AskDbError, SqlValidationError } from "../errors.js";
import { generatePostgresSelectSql } from "./generate.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

const here = dirname(fileURLToPath(import.meta.url));
const sensitiveFixture = join(here, "../../../../fixtures/schemas/orders-users-sensitive.schema.json");

describe("generatePostgresSelectSql", () => {
  it("parses fenced SQL and validates SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const out = await generatePostgresSelectSql("list users", minimalSchema, fakeModel, {
      generateText,
    });
    expect(out.sql).toBe("SELECT id FROM users");
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

  it("rejects empty-table schema before calling the model", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT 1\n```",
    }));
    await expect(
      generatePostgresSelectSql("anything", { tables: [] }, fakeModel, { generateText }),
    ).rejects.toThrow(AskDbError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("appends join-ambiguity context when the schema has a single table but the question sounds like a join", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generatePostgresSelectSql("How do orders join to users?", minimalSchema, fakeModel, {
      generateText,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Context (deterministic checks from AskDB");
    expect(prompt).toContain("only one table");
    expect(prompt).toContain("users");
  });

  it("appends unknown-table context when the question echoes FROM/JOIN with a missing table name", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generatePostgresSelectSql("Run select * from phantom", minimalSchema, fakeModel, {
      generateText,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('table "phantom"');
    expect(prompt).toContain("users");
  });

  it("lists sensitive column names in the model prompt by default (fixture)", async () => {
    const schema = loadNormalizedSchemaFromJson(readFileSync(sensitiveFixture, "utf8"));
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const debug = vi.fn();
    await generatePostgresSelectSql("list users", schema, fakeModel, {
      generateText,
      logger: { info: vi.fn(), error: vi.fn(), debug },
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toMatch(/secret_recovery_token/i);
    expect(prompt).toContain("(sensitive)");
    expect(prompt).toContain("email");
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PromptSensitiveIdentifiersListed,
        listedSensitiveColumnCount: 1,
      }),
      expect.any(String),
    );
  });

  it("omits sensitive identifiers from the prompt when deps omit flag is set", async () => {
    const schema = loadNormalizedSchemaFromJson(readFileSync(sensitiveFixture, "utf8"));
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const debug = vi.fn();
    await generatePostgresSelectSql("list users", schema, fakeModel, {
      generateText,
      omitSensitiveIdentifiersFromNlToSqlPrompt: true,
      logger: { info: vi.fn(), error: vi.fn(), debug },
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toMatch(/secret_recovery_token/i);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PromptSensitiveRedacted,
        redactedColumnCount: 1,
        sensitiveTableStubCount: 0,
      }),
      expect.any(String),
    );
  });

  it("returns explain metadata when deps.explain is true", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nWITH c AS (SELECT 1 AS n) SELECT n FROM c\n```",
    }));
    const out = await generatePostgresSelectSql("count", minimalSchema, fakeModel, {
      generateText,
      explain: true,
    });
    expect(out.sql).toContain("WITH c AS");
    expect(out.explain?.statementKind).toBe("with");
    expect(out.explain?.checksVerified).toContain("no_blocked_write_or_ddl_keywords");
    expect(out.explain?.remediationNote).toContain("Heuristic");
  });
});

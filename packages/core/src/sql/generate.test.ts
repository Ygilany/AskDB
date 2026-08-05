import type { LanguageModel } from "ai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AskDbError, SqlValidationError } from "../errors.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import { loadNormalizedSchemaFromJson } from "../schema/parse.js";
import type { NormalizedSchema } from "../schema/types.js";
import {
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
} from "./dialect-spec.js";
import { generateSelectSql } from "./generate.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

const here = dirname(fileURLToPath(import.meta.url));
const sensitiveFixture = join(here, "../../../../fixtures/schemas/orders-users-sensitive.schema.json");


describe("generateSelectSql (postgres)", () => {
  it("parses fenced SQL and validates SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });
    expect(out.sql).toBe("SELECT id FROM users");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("does not send providerOptions to generateText when unset (preserves current behavior)", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });
    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect("providerOptions" in call).toBe(false);
  });

  it("forwards deps.providerOptions verbatim to generateText when set", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const providerOptions = { openai: { reasoningEffort: "low" } };
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      providerOptions,
    });
    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.providerOptions).toBe(providerOptions);
  });

  it("normalizes AI SDK 6 input and output token usage", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
      usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
    }));

    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });

    expect(out.usage).toEqual({
      promptTokens: 120,
      completionTokens: 24,
      totalTokens: 144,
    });
  });

  it("surfaces SqlValidationError when model returns non-SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nDELETE FROM users\n```",
    }));
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "nuke", minimalSchema, fakeModel, {
        generateText,
      }),
    ).rejects.toThrow(SqlValidationError);
  });

  it("rejects empty-table schema before calling the model", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT 1\n```",
    }));
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "anything", { tables: [] }, fakeModel, { generateText }),
    ).rejects.toThrow(AskDbError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("appends join-ambiguity context when the schema has a single table but the question sounds like a join", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "How do orders join to users?", minimalSchema, fakeModel, {
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
    await generateSelectSql(POSTGRES_DIALECT, "Run select * from phantom", minimalSchema, fakeModel, {
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
    await generateSelectSql(POSTGRES_DIALECT, "list users", schema, fakeModel, {
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
    await generateSelectSql(POSTGRES_DIALECT, "list users", schema, fakeModel, {
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
    const out = await generateSelectSql(POSTGRES_DIALECT, "count", minimalSchema, fakeModel, {
      generateText,
      explain: true,
    });
    expect(out.sql).toContain("WITH c AS");
    expect(out.explain?.statementKind).toBe("with");
    expect(out.explain?.checksVerified).toContain("no_blocked_write_or_ddl_keywords");
    expect(out.explain?.remediationNote).toContain("Heuristic");
  });
});

describe("generateSelectSql — prompt parameterization per dialect", () => {
  async function capturedPrompt(
    dialect: typeof POSTGRES_DIALECT,
    sqlForModel: string,
  ): Promise<{ instructions: string; prompt: string }> {
    const generateText = vi.fn(async () => ({ text: `\`\`\`sql\n${sqlForModel}\n\`\`\`` }));
    await generateSelectSql(dialect, "show me users", minimalSchema, fakeModel, {
      generateText,
    });
    const call = generateText.mock.calls[0]![0] as { instructions: string; prompt: string };
    return { instructions: call.instructions, prompt: call.prompt };
  }

  it("MySQL prompt mentions backticks and CONCAT(), system prompt names MySQL", async () => {
    const { instructions, prompt } = await capturedPrompt(MYSQL_DIALECT, "SELECT id FROM users");
    expect(instructions).toMatch(/MySQL/);
    expect(prompt).toMatch(/MySQL SELECT/);
    expect(prompt).toMatch(/backtick/i);
    expect(prompt).toMatch(/CONCAT/);
  });

  it("SQLite prompt mentions strftime() and `||` concat, system prompt names SQLite", async () => {
    const { instructions, prompt } = await capturedPrompt(SQLITE_DIALECT, "SELECT id FROM users");
    expect(instructions).toMatch(/SQLite/);
    expect(prompt).toMatch(/SQLite SELECT/);
    expect(prompt).toMatch(/strftime/);
    expect(prompt).toMatch(/\|\|/);
  });

  it("SQL Server prompt mentions TOP and OFFSET .. FETCH NEXT", async () => {
    const { instructions, prompt } = await capturedPrompt(
      SQLSERVER_DIALECT,
      "SELECT TOP (5) id FROM users",
    );
    expect(instructions).toMatch(/SQL Server/);
    expect(prompt).toMatch(/SQL Server SELECT/);
    expect(prompt).toMatch(/TOP/);
    expect(prompt).toMatch(/OFFSET .* FETCH NEXT/);
  });

  it("rejects SQLite ATTACH via dialect's extraForbiddenKeywords", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT * FROM users; ATTACH 'other.db' AS o\n```",
    }));
    await expect(
      generateSelectSql(SQLITE_DIALECT, "list users", minimalSchema, fakeModel, { generateText }),
    ).rejects.toThrow(SqlValidationError);
  });

  it("rejects SQL Server EXEC via dialect's extraForbiddenKeywords", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users WHERE id = exec('boom')\n```",
    }));
    await expect(
      generateSelectSql(SQLSERVER_DIALECT, "list users", minimalSchema, fakeModel, {
        generateText,
      }),
    ).rejects.toThrow(SqlValidationError);
  });
});

describe("generateSelectSql — parameterize prompt + extras", () => {
  it("keeps the flag-off prompt byte-identical to the pre-parameterize path", async () => {
    const generateTextOff = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const generateTextDefault = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText: generateTextOff,
      parameterize: false,
    });
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText: generateTextDefault,
      // parameterize omitted — generate only enables when explicitly true
    });
    const off = (generateTextOff.mock.calls[0]![0] as { prompt: string }).prompt;
    const def = (generateTextDefault.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(off).toBe(def);
    expect(off).not.toContain("Parameterized output format");
  });

  it("appends parameterize instructions when parameterize is true", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Parameterized output format");
    expect(prompt).toContain("sql-unbound");
    expect(prompt).toContain("= ANY(:name)");
  });

  it("returns unboundNamedSql + manifest when the model complies", async () => {
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT count(*) FROM cities WHERE state = 'colorado'",
        "```",
        "```sql-unbound",
        "SELECT count(*) FROM cities WHERE state = :state_name",
        "```",
        "```json",
        '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
        "```",
      ].join("\n"),
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "how many in colorado", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(out.unboundNamedSql).toBe("SELECT count(*) FROM cities WHERE state = :state_name");
    expect(out.parameterManifest?.parameters).toHaveLength(1);
  });

  it("drops extras when unbound is missing — bound SQL unaffected", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT id FROM users");
    expect(out.unboundNamedSql).toBeUndefined();
    expect(out.parameterManifest).toBeUndefined();
  });

  it("drops extras when a quoted marker makes the placeholder invisible", async () => {
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT count(*) FROM cities WHERE state = 'colorado'",
        "```",
        "```sql-unbound",
        "SELECT count(*) FROM cities WHERE state = ':state_name'",
        "```",
        "```json",
        '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
        "```",
      ].join("\n"),
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "how many in colorado", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(out.unboundNamedSql).toBeUndefined();
    expect(out.parameterManifest).toBeUndefined();
  });
});

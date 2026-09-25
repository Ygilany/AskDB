import type { LanguageModel } from "ai";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ask } from "../../ask.js";
import { validateSensitiveReferences } from "../../sql/sensitive-guardrail.js";
import { loadSchema, loadSchemaFromJson } from "./loader.js";

/**
 * Front-matter sensitivity is escalate-only: `sensitive: true` in a table's markdown
 * front-matter (what Studio / @askdb/enrich write) marks a table or column sensitive on
 * top of schema.json; `sensitive: false` can never un-mark one.
 */

const physical = {
  version: 2,
  schemaId: "people",
  tables: [
    {
      id: "table:public.users",
      name: "users",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.users#id", name: "id", type: "integer", nullable: false, primaryKey: true, sensitive: false },
        { id: "table:public.users#email", name: "email", type: "text", nullable: false, sensitive: true },
        { id: "table:public.users#ssn", name: "ssn", type: "text", nullable: true, sensitive: false },
        { id: "table:public.users#created_at", name: "created_at", type: "timestamptz", nullable: false, sensitive: false },
      ],
    },
    {
      id: "table:public.audit_log",
      name: "audit_log",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.audit_log#id", name: "id", type: "integer", nullable: false, primaryKey: true, sensitive: false },
        { id: "table:public.audit_log#payload", name: "payload", type: "jsonb", nullable: false, sensitive: false },
      ],
    },
    {
      id: "table:public.secrets",
      name: "secrets",
      schema: "public",
      sensitive: true,
      columns: [
        { id: "table:public.secrets#id", name: "id", type: "integer", nullable: false, primaryKey: true, sensitive: false },
        { id: "table:public.secrets#token", name: "token", type: "text", nullable: false, sensitive: false },
      ],
    },
  ],
};

const tableMarkdowns: Record<string, string> = {
  // Column-level escalation (ssn) and a column-level downgrade attempt (email).
  "users.md": [
    "---",
    "id: table:public.users",
    "name: users",
    "schemaId: people",
    "columns:",
    "  - id: table:public.users#email",
    "    sensitive: false",
    "  - id: table:public.users#ssn",
    "    description: Social security number.",
    "    aliases: [social]",
    "    sensitive: true",
    "  - id: table:public.users#created_at",
    "    description: When the account was created.",
    "---",
    "",
    "# Table: users",
    "",
    "Registered user accounts.",
    "",
  ].join("\n"),
  // Table-level escalation.
  "audit_log.md": [
    "---",
    "id: table:public.audit_log",
    "name: audit_log",
    "schemaId: people",
    "aliases: [audit_trail]",
    "sensitive: true",
    "---",
    "",
    "# Table: audit_log",
    "",
    "Every privileged action.",
    "",
  ].join("\n"),
  // Table-level downgrade attempt.
  "secrets.md": [
    "---",
    "id: table:public.secrets",
    "name: secrets",
    "schemaId: people",
    "sensitive: false",
    "---",
    "",
    "# Table: secrets",
    "",
    "API tokens.",
    "",
  ].join("\n"),
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeSchemaDir(markdowns: Record<string, string> = tableMarkdowns): string {
  const dir = join(mkdtempSync(join(tmpdir(), "askdb-sensitivity-")), "people.schema");
  tempDirs.push(dirname(dir));
  mkdirSync(join(dir, "tables"), { recursive: true });
  writeFileSync(join(dir, "schema.json"), JSON.stringify(physical, null, 2));
  for (const [file, content] of Object.entries(markdowns)) {
    writeFileSync(join(dir, "tables", file), content);
  }
  return dir;
}

const bundleJson = () =>
  JSON.stringify({ bundled: true, physical, tables: tableMarkdowns });

const fakeModel = {} as LanguageModel;

describe("loadSchema — front-matter sensitivity is escalate-only", () => {
  it("front-matter `sensitive: true` escalates a column schema.json leaves non-sensitive", () => {
    const users = loadSchema(writeSchemaDir()).tables.find((t) => t.name === "users")!;
    const ssn = users.columns.find((c) => c.name === "ssn")!;
    expect(ssn.sensitive).toBe(true);
    // Escalated columns drop their describable fields exactly like schema.json-sensitive ones.
    expect(ssn.description).toBeUndefined();
    expect(ssn.aliases).toBeUndefined();

    const createdAt = users.columns.find((c) => c.name === "created_at")!;
    expect(createdAt.sensitive).toBe(false);
    expect(createdAt.description).toBe("When the account was created.");
    expect(users.sensitive).toBe(false);
  });

  it("without the front-matter, the same column is not sensitive (control)", () => {
    const users = loadSchema(writeSchemaDir({})).tables.find((t) => t.name === "users")!;
    expect(users.columns.find((c) => c.name === "ssn")!.sensitive).toBe(false);
  });

  it("front-matter `sensitive: true` escalates a table and every column in it", () => {
    const audit = loadSchema(writeSchemaDir()).tables.find((t) => t.name === "audit_log")!;
    expect(audit.sensitive).toBe(true);
    expect(audit.columns.every((c) => c.sensitive)).toBe(true);
    expect(audit.description).toBeUndefined();
    expect(audit.aliases).toBeUndefined();
  });

  it("front-matter `sensitive: false` cannot de-escalate a column or table, and warns", () => {
    const schema = loadSchema(writeSchemaDir());
    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.columns.find((c) => c.name === "email")!.sensitive).toBe(true);

    const secrets = schema.tables.find((t) => t.name === "secrets")!;
    expect(secrets.sensitive).toBe(true);
    expect(secrets.columns.every((c) => c.sensitive)).toBe(true);
    expect(secrets.description).toBeUndefined();

    expect(schema.warnings).toEqual(
      expect.arrayContaining([
        { kind: "sensitivity_downgrade_ignored", tableFile: "tables/users.md", id: "table:public.users#email" },
        { kind: "sensitivity_downgrade_ignored", tableFile: "tables/secrets.md", id: "table:public.secrets" },
      ]),
    );
    expect(schema.warnings.filter((w) => w.kind === "sensitivity_downgrade_ignored")).toHaveLength(2);
  });

  it("a front-matter `sensitive: false` that agrees with schema.json is a silent no-op", () => {
    const md = [
      "---",
      "id: table:public.users",
      "name: users",
      "schemaId: people",
      "sensitive: false",
      "columns:",
      "  - id: table:public.users#ssn",
      "    sensitive: false",
      "---",
      "",
      "# Table: users",
      "",
    ].join("\n");
    const schema = loadSchema(writeSchemaDir({ "users.md": md }));
    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.sensitive).toBe(false);
    expect(users.columns.find((c) => c.name === "ssn")!.sensitive).toBe(false);
    expect(schema.warnings).toEqual([]);
  });

  it("the bundle path produces exactly the directory result", () => {
    const fromDir = loadSchema(writeSchemaDir());
    expect(loadSchemaFromJson(bundleJson())).toEqual(fromDir);

    const bundleFile = join(mkdtempSync(join(tmpdir(), "askdb-sensitivity-bundle-")), "people.bundle.json");
    tempDirs.push(dirname(bundleFile));
    writeFileSync(bundleFile, bundleJson());
    expect(loadSchema(bundleFile)).toEqual(fromDir);
  });
});

describe("front-matter-escalated sensitivity reaches prompts and the SQL guardrail", () => {
  const sqlResponse = { text: "```sql\nSELECT COUNT(*) FROM users\n```" };

  async function promptFor(omitSensitive: boolean): Promise<string> {
    const generateText = vi.fn(async () => sqlResponse);
    await ask({
      question: "How many accounts were created last month?",
      schema: loadSchema(writeSchemaDir()),
      model: fakeModel,
      dialect: "postgres",
      omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitive,
      deps: { generateText: generateText as never },
    });
    expect(generateText).toHaveBeenCalledOnce();
    return JSON.stringify((generateText.mock.calls as unknown[][])[0]![0]);
  }

  it("omitSensitiveIdentifiersFromNlToSqlPrompt omits a front-matter-escalated column and table", async () => {
    const prompt = await promptFor(true);
    expect(prompt).toContain("created_at");
    expect(prompt).not.toMatch(/\bssn\b/);
    // Omission mode keeps a sensitive table's name but withholds its columns and prose.
    expect(prompt).toContain(
      "TABLE public.audit_log\\n  (sensitive table — column definitions withheld from model context)",
    );
    expect(prompt).not.toContain("payload");
    expect(prompt).not.toContain("audit_trail");
    expect(prompt).not.toContain("Every privileged action");
  });

  it("by default the escalated column is listed and tagged (sensitive)", async () => {
    const prompt = await promptFor(false);
    expect(prompt).toMatch(/ssn text[^\\]*\(sensitive\)/);
  });

  it("validateSensitiveReferences flags a front-matter-escalated column and table", () => {
    const schema = loadSchema(writeSchemaDir());

    const column = validateSensitiveReferences("SELECT u.ssn FROM users u", schema);
    expect(column.passed).toBe(false);
    expect(column.references).toEqual([
      expect.objectContaining({ table: "users", column: "ssn", matchKind: "qualified" }),
    ]);

    const table = validateSensitiveReferences("SELECT COUNT(*) FROM audit_log", schema);
    expect(table.passed).toBe(false);
    expect(table.references).toEqual([
      expect.objectContaining({ table: "audit_log", column: "*", matchKind: "table" }),
    ]);
  });

  it("ask() attaches a failing sensitiveGuardrail for SQL touching the escalated column", async () => {
    const result = await ask({
      question: "list ssns",
      schema: loadSchema(writeSchemaDir()),
      model: fakeModel,
      dialect: { generate: async () => ({ sql: "SELECT ssn FROM users" }) },
    });
    expect(result.sensitiveGuardrail?.passed).toBe(false);
    expect(result.sensitiveGuardrail?.references).toEqual([
      expect.objectContaining({ table: "users", column: "ssn" }),
    ]);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmptyIntrospectionError } from "./errors.js";
import { introspect } from "./introspect.js";
import { isSchemaV2Json, renderSchemaV2Body, renderToSchemaV2 } from "./render/render.js";
import type { Connector, IntrospectionResult, SqlSchema } from "./types.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-e2e-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

type FakeInput = { tag: string };

const fakeSchema: SqlSchema = {
  schemaId: "fake",
  schemas: [
    {
      name: "public",
      tables: [
        {
          id: "table:public.users",
          schema: "public",
          name: "users",
          columns: [
            {
              id: "table:public.users#id",
              name: "id",
              ordinalPosition: 1,
              dataType: "uuid",
              udtName: "uuid",
              nullable: false,
              primaryKey: true,
            },
          ],
          primaryKey: { columns: ["id"] },
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
          checkConstraints: [],
        },
      ],
      views: [],
      enums: [],
      sequences: [],
    },
  ],
};

function emptyConnector(schema: SqlSchema, isEmpty = true): Connector<FakeInput> {
  return {
    async describe() {
      return { schema, warnings: [], isEmpty, viewDefinitions: {} };
    },
  };
}

function makeFakeConnector(calls: string[]): Connector<FakeInput> {
  return {
    async describe(input): Promise<IntrospectionResult> {
      calls.push(input.tag);
      return {
        schema: fakeSchema,
        warnings: [],
        isEmpty: false,
        viewDefinitions: {},
      };
    },
  };
}

describe("introspect() — engine-agnostic orchestrator", () => {
  it("delegates to the supplied connector and returns its IntrospectionResult when no renderOptions are passed", async () => {
    const calls: string[] = [];
    const connector = makeFakeConnector(calls);
    const result = await introspect<FakeInput>({ tag: "hello" }, undefined, { connector });

    expect(calls).toEqual(["hello"]);
    expect(result.schema.schemaId).toBe("fake");
    expect(result.render).toBeUndefined();
  });

  it("writes the rendered Schema v2 directory when renderOptions are supplied", async () => {
    const connector = makeFakeConnector([]);
    const outDir = join(workDir, "fake.schema");

    const result = await introspect<FakeInput>(
      { tag: "render" },
      { outDir, schemaId: "fake" },
      { connector },
    );

    expect(result.render?.schemaJsonPath).toBe(join(outDir, "schema.json"));
    const written = readFileSync(result.render!.schemaJsonPath, "utf8");
    expect(written).toContain('"schemaId": "fake"');
    expect(written).toContain('"table:public.users"');
  });

  // A checkout can carry `schema.json -> <anything>` (git stores symbolic links), and
  // `askdb introspect --out` and Studio's Resync write into that directory.
  it("refuses to write schema.json through a symbolic link", () => {
    const outDir = join(workDir, "fake.schema");
    mkdirSync(outDir);
    const outside = join(workDir, "outside.json");
    writeFileSync(outside, "untouched\n", "utf8");
    symlinkSync(outside, join(outDir, "schema.json"));

    expect(() => renderToSchemaV2(fakeSchema, { outDir, schemaId: "fake" })).toThrow(
      'Refusing to write schema.json outside the schema directory: "schema.json" is a symbolic link',
    );
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });

  // MySQL and SQLite `describe()` return `schemas: []` for a database with no tables or views,
  // and an artifact with no tables can't be loaded, so introspection refuses to write one (#337,
  // ADR 0037).
  it("refuses an empty SqlSchema (no namespaces) and writes nothing", async () => {
    const outDir = join(workDir, "empty.schema");

    const error = await introspect<FakeInput>({ tag: "empty" }, { outDir, schemaId: "empty" }, { connector: emptyConnector({ schemaId: "empty", schemas: [] }) }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect(existsSync(outDir)).toBe(false);
  });

  // Postgres reports a database with only enums or sequences as not empty, but it renders no tables.
  it("refuses a namespace with only enums and sequences, since it renders no tables", async () => {
    const enumsOnly: SqlSchema = {
      schemaId: "enums",
      schemas: [{ name: "public", tables: [], views: [], enums: [{ name: "mood", values: ["happy"] }], sequences: [{ name: "ids" }] } as unknown as SqlSchema["schemas"][number]],
    };
    const outDir = join(workDir, "enums.schema");

    const error = await introspect<FakeInput>({ tag: "enums" }, { outDir, schemaId: "enums" }, { connector: emptyConnector(enumsOnly, false) }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect(existsSync(join(outDir, "schema.json"))).toBe(false);
  });

  it("leaves an existing artifact as it was when re-introspection finds nothing", async () => {
    const outDir = join(workDir, "fake.schema");
    await introspect<FakeInput>({ tag: "first" }, { outDir, schemaId: "fake" }, { connector: makeFakeConnector([]) });
    mkdirSync(join(outDir, "tables"), { recursive: true });
    writeFileSync(join(outDir, "tables", "users.md"), "---\nid: table:public.users\n---\nPeople.\n", "utf8");
    const before = [readFileSync(join(outDir, "schema.json")), readFileSync(join(outDir, "tables", "users.md"))];

    const error = await introspect<FakeInput>(
      { tag: "again" },
      { outDir, schemaId: "fake", existingArtifactDir: outDir },
      { connector: emptyConnector({ schemaId: "fake", schemas: [] }) },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect([readFileSync(join(outDir, "schema.json")), readFileSync(join(outDir, "tables", "users.md"))]).toEqual(before);
  });

  it("names the schema id, the engine and the filters, and nothing from the connection", async () => {
    const outDir = join(workDir, "shop.schema");
    const connector: Connector<{ url: string }> = {
      async describe() {
        return { schema: { schemaId: "shop", schemas: [] }, warnings: [], isEmpty: true, viewDefinitions: {}, provider: "sqlite" };
      },
    };

    const error = await introspect(
      { url: "postgres://admin:S3cret@db.internal/shop" },
      { outDir, schemaId: "shop", filters: { schemas: ["sales"], excludeSchemas: ["tmp"], tables: ["sales.orders*"] } },
      { connector },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect(error).toMatchObject({ schemaId: "shop", provider: "sqlite", filters: { schemas: ["sales"], tables: ["sales.orders*"] } });
    const message = (error as Error).message;
    expect(message).toContain('Introspection found no tables or views for schema "shop" (sqlite), so nothing was written.');
    expect(message).toContain("schemas: sales; exclude schemas: tmp; tables: sales.orders*");
    expect(message).not.toMatch(/S3cret|admin|db\.internal/);
  });

  it("merges connector and render warnings", async () => {
    const connector: Connector<FakeInput> = {
      async describe() {
        return {
          schema: fakeSchema,
          warnings: [{ code: "ambiguous_filter", filter: "public.missing" }],
          isEmpty: false,
          viewDefinitions: {},
        };
      },
    };
    // An existing artifact without the fake schema's column makes the render report it as new.
    const existingDir = join(workDir, "existing.schema");
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      join(existingDir, "schema.json"),
      JSON.stringify({ version: 2, schemaId: "fake", tables: [] }),
      "utf8",
    );
    const outDir = join(workDir, "fake.schema");
    const result = await introspect<FakeInput>(
      { tag: "warn" },
      { outDir, schemaId: "fake", existingArtifactDir: existingDir },
      { connector },
    );

    expect(result.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.missing" },
      { code: "new_column", id: "table:public.users#id", tableId: "table:public.users" },
    ]);
  });
});

describe("renderSchemaV2Body() — shared by --out, --print and --diff", () => {
  it("refuses an empty render, so --print and --diff refuse it as --out does", () => {
    expect(() => renderSchemaV2Body({ schemaId: "empty", schemas: [] }, { schemaId: "empty" })).toThrow(EmptyIntrospectionError);
  });

  it("introspect() forwards the connector's provider into the schema.json it writes", async () => {
    const connector: Connector<FakeInput> = {
      async describe() {
        return {
          schema: fakeSchema,
          warnings: [],
          isEmpty: false,
          viewDefinitions: {},
          provider: "postgres",
        };
      },
    };
    const outDir = join(workDir, "fake.schema");
    await introspect<FakeInput>({ tag: "out" }, { outDir, schemaId: "fake" }, { connector });
    const written = readFileSync(join(outDir, "schema.json"), "utf8");

    expect((JSON.parse(written) as { provider?: string }).provider).toBe("postgres");
  });

  it("preserves human-set sensitive flags from an existing artifact", () => {
    const existingDir = join(workDir, "existing.schema");
    const first = renderSchemaV2Body(fakeSchema, { schemaId: "fake" });
    const edited = JSON.parse(first.body) as {
      tables: Array<{ sensitive: boolean; columns: Array<{ sensitive: boolean }> }>;
    };
    edited.tables[0]!.sensitive = true;
    edited.tables[0]!.columns[0]!.sensitive = true;
    const editedBody = JSON.stringify(edited, null, 2) + "\n";
    rmSync(existingDir, { recursive: true, force: true });
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, "schema.json"), editedBody, "utf8");

    const merged = renderSchemaV2Body(fakeSchema, {
      schemaId: "fake",
      existingArtifactDir: existingDir,
    });
    expect(merged.body).toBe(editedBody);
    expect(merged.warnings).toEqual([]);
  });

  it.each([
    ["table", (t: { sensitive: unknown; columns: Array<{ sensitive: unknown }> }) => (t.sensitive = "yes")],
    ["column", (t: { sensitive: unknown; columns: Array<{ sensitive: unknown }> }) => (t.columns[0]!.sensitive = 1)],
  ])("rejects an existing artifact whose %s sensitive flag isn't a boolean instead of copying it", (_level, edit) => {
    const existingDir = join(workDir, "non-boolean.schema");
    const edited = JSON.parse(renderSchemaV2Body(fakeSchema, { schemaId: "fake" }).body) as {
      tables: Array<{ sensitive: unknown; columns: Array<{ sensitive: unknown }> }>;
    };
    edit(edited.tables[0]!);
    rmSync(existingDir, { recursive: true, force: true });
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, "schema.json"), JSON.stringify(edited), "utf8");

    expect(isSchemaV2Json(edited)).toBe(false);
    expect(() => renderSchemaV2Body(fakeSchema, { schemaId: "fake", existingArtifactDir: existingDir })).toThrow(
      "invalid Schema v2",
    );
  });
});

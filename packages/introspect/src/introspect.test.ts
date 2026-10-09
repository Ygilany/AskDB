import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { introspect } from "./introspect.js";
import { isSchemaV2Json, renderSchemaV2Body } from "./render/render.js";
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

  // MySQL and SQLite `describe()` return `schemas: []` for a database with no tables or
  // views, and `askdb introspect --out` renders that result. This pins today's behaviour;
  // #337 decides whether it becomes a clear refusal instead (then flip this test).
  it("renders an empty SqlSchema (no namespaces) to a schema.json with no tables", async () => {
    const connector: Connector<FakeInput> = {
      async describe() {
        return {
          schema: { schemaId: "empty", schemas: [] },
          warnings: [],
          isEmpty: true,
          viewDefinitions: {},
        };
      },
    };
    const outDir = join(workDir, "empty.schema");

    const result = await introspect<FakeInput>(
      { tag: "empty" },
      { outDir, schemaId: "empty" },
      { connector },
    );

    expect(result.isEmpty).toBe(true);
    expect(JSON.parse(readFileSync(result.render!.schemaJsonPath, "utf8"))).toEqual({
      version: 2,
      schemaId: "empty",
      tables: [],
    });
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
    const outDir = join(workDir, "fake.schema");
    const result = await introspect<FakeInput>(
      { tag: "warn" },
      { outDir, schemaId: "fake" },
      { connector },
    );

    expect(result.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.missing" },
    ]);
  });
});

describe("renderSchemaV2Body() — shared by --out, --print and --diff", () => {
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

/**
 * Introspecting a real SQLite file that renders no tables (#337, ADR 0037): the SQLite adapter
 * and `introspect()` refuse to write an artifact `loadSchema` would reject. Skipped when the
 * optional driver is missing, and failed instead under ASKDB_REQUIRE_INTEGRATION=1.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type DatabaseCtor from "better-sqlite3";
import { EmptyIntrospectionError, introspect, type IntrospectionFilters } from "@askdb/introspect";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";
import { sqliteConnectorProvider } from "./provider.js";

type Bs3Namespace = { default: typeof DatabaseCtor };

async function loadDriver(): Promise<{ driver?: Bs3Namespace; unavailable?: string }> {
  try {
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    new mod.default(":memory:").close();
    return { driver: mod };
  } catch (err) {
    return {
      unavailable: `better-sqlite3 could not be loaded (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

const { driver, unavailable } = await loadDriver();
const suite = integrationSuite({ unavailable });

suite("introspecting a SQLite file with nothing to render", () => {
  let dir: string;
  let file: string;
  let outDir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "askdb-sqlite-empty-"));
    file = join(dir, "app.db");
    outDir = join(dir, "app.schema");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function exec(sql: string): void {
    const db = new driver!.default(file);
    db.exec(sql);
    db.close();
  }

  async function run(filters?: IntrospectionFilters, existingArtifact = false): Promise<unknown> {
    const { connector, input } = sqliteConnectorProvider.createConnector({ provider: "sqlite", url: file, filters });
    return introspect(
      input,
      { outDir, schemaId: "app", filters, existingArtifactDir: existingArtifact ? outDir : undefined },
      { connector },
    ).catch((error: unknown) => error);
  }

  it("refuses an empty database file and writes nothing", async () => {
    exec("PRAGMA user_version = 1;");

    const error = await run();

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect((error as Error).message).toContain('no tables or views for schema "app" (sqlite)');
    expect(existsSync(join(outDir, "schema.json"))).toBe(false);
  });

  it("refuses table filters that match nothing, and names them", async () => {
    exec("CREATE TABLE orders (id INTEGER PRIMARY KEY);");

    const error = await run({ tables: ["main.nothing*"] });

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect((error as Error).message).toContain("the filters match nothing (tables: main.nothing*)");
    expect(existsSync(join(outDir, "schema.json"))).toBe(false);
  });

  it("leaves a valid artifact unchanged when the database it came from has lost its tables", async () => {
    exec("CREATE TABLE orders (id INTEGER PRIMARY KEY);");
    expect(await run()).toMatchObject({ render: { schemaJsonPath: join(outDir, "schema.json") } });
    const before = readFileSync(join(outDir, "schema.json"));
    exec("DROP TABLE orders;");

    const error = await run(undefined, true);

    expect(error).toBeInstanceOf(EmptyIntrospectionError);
    expect(readFileSync(join(outDir, "schema.json"))).toEqual(before);
  });
});

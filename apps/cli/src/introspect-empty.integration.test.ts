/**
 * `askdb introspect --engine sqlite` against a real SQLite file with no tables (#337, ADR 0037):
 * the built-in registry, the SQLite adapter and the CLI's exit code end to end. Skipped when
 * `better-sqlite3` can't load, and failed instead under ASKDB_REQUIRE_INTEGRATION=1.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetAskDbRuntimeForTests, setAskDbRuntimeForTests } from "@askdb/config";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { runIntrospectCli } from "./introspect.js";

// The runtime config is installed in-process; the config-file check is covered by the spawned CLI tests.
vi.mock("./project-config.js", () => ({ requireAskDbConfig: vi.fn() }));

type Bs3 = typeof import("better-sqlite3");

// `better-sqlite3` is @askdb/sqlite's optional peer, resolved from there as the CLI does.
function loadDriver(): { Database?: Bs3; unavailable?: string } {
  try {
    const fromSqlite = createRequire(import.meta.resolve("@askdb/sqlite"));
    const Database = fromSqlite("better-sqlite3") as Bs3;
    new Database(":memory:").close();
    return { Database };
  } catch (err) {
    return { unavailable: `better-sqlite3 could not be loaded (${err instanceof Error ? err.message : String(err)})` };
  }
}

const { Database, unavailable } = loadDriver();
const suite = integrationSuite({ unavailable });

suite("askdb introspect --engine sqlite against a file with no tables", () => {
  let dir: string;
  let stderr = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "askdb-cli-empty-"));
    stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    setAskDbRuntimeForTests({
      ai: { provider: "openai", providerConfig: { openai: { apiKey: "test-key" } } },
      introspection: { provider: "sqlite", providerConfig: { sqlite: {} }, outputDir: "./askdb/" },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetAskDbRuntimeForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with the reason and writes no schema.json", async () => {
    const file = join(dir, "app.db");
    const db = new Database!(file);
    db.exec("PRAGMA user_version = 1;");
    db.close();
    const out = join(dir, "app.schema");

    expect(await runIntrospectCli(["--engine", "sqlite", "--url", file, "--out", out])).toBe(1);

    expect(stderr).toContain('Introspection found no tables or views for schema "app" (sqlite), so nothing was written.');
    expect(existsSync(join(out, "schema.json"))).toBe(false);
  });
});

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAskDbRuntimeForTests } from "@askdb/config";
import { runAskCli } from "./ask.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../../../fixtures/schemas/orders-users.schema");

let stdout = "";
let stderr = "";
let project: string;
let cwd: string;

/** A project directory with an askdb.config that points `--schema`'s default at the fixture. */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-ask-"));
  const config = {
    ai: { provider: "openai", providerConfig: { openai: {} } },
    introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: FIXTURE_DIR },
  };
  writeFileSync(join(dir, "askdb.config.mjs"), `export default ${JSON.stringify(config)};\n`);
  return dir;
}

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  cwd = process.cwd();
  project = makeProject();
  process.chdir(project);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  rmSync(project, { recursive: true, force: true });
  resetAskDbRuntimeForTests();
});

describe("askdb ask", () => {
  it("prints the checked SQL on stdout after -- sql --", async () => {
    expect(await runAskCli(["-q", "Which users?", "--mock-sql", "SELECT id FROM users"])).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("-- sql --\nSELECT id FROM users\n");
  });

  it("follows the SQL with the guardrail JSON under --explain", async () => {
    expect(await runAskCli(["--question=Which users?", "--mock-sql=SELECT id FROM users", "--explain"])).toBe(0);
    const [sql, explain] = stdout.split("-- explain --\n");
    expect(sql).toBe("-- sql --\nSELECT id FROM users\n");
    expect(JSON.parse(explain!)).toMatchObject({
      statementKind: "select",
      checksVerified: expect.arrayContaining(["single_statement", "leading_select_or_with"]),
    });
  });

  it("refuses SQL that writes, naming the rule on stderr, and exits 1", async () => {
    expect(await runAskCli(["-q", "Drop them", "--mock-sql", "DELETE FROM users"])).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^SqlValidationError \[[\w-]+\]: /);
  });

  it("rejects an unknown --mode and exits 1", async () => {
    expect(await runAskCli(["-q", "x", "--mock-sql", "SELECT 1", "--mode", "loose"])).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe('AskDbError: Invalid mode: "loose". Expected one of: schema_only, bounded_results.\n');
  });

  it("leaves a missing askdb.config to the top-level handler", async () => {
    const empty = mkdtempSync(join(tmpdir(), "askdb-ask-empty-"));
    process.chdir(empty);
    try {
      await expect(runAskCli(["-q", "x", "--mock-sql", "SELECT 1"])).rejects.toThrow(
        "No askdb.config.* or .config/askdb.* found in",
      );
      expect(stdout).toBe("");
    } finally {
      process.chdir(project);
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("askdb ask prints the loader's warnings on stderr", () => {
  it("prints each warning as one line, and still answers", async () => {
    const dir = join(project, "orders-users.schema");
    cpSync(FIXTURE_DIR, dir, { recursive: true });
    const orders = join(dir, "tables/orders.md");
    writeFileSync(
      orders,
      readFileSync(orders, "utf8").replace(
        "  - id: table:public.orders#id\n    aliases: [order_id]\n",
        "  - id: table:public.orders#id\n    aliases: [order_id]\n  - id: table:public.orders#id\n    aliases: [again]\n",
      ),
    );

    expect(await runAskCli(["-q", "Which users?", "--mock-sql", "SELECT id FROM users", "--schema", dir])).toBe(0);
    expect(stderr).toBe(
      "Warning: tables/orders.md lists column table:public.orders#id more than once; only the first entry's description, aliases and enum apply\n",
    );
    expect(stdout).toContain("SELECT id FROM users");
  });
});

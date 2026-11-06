import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAskDbRuntimeForTests } from "@askdb/config";
import { runAskCli } from "./ask.js";
import { runInitCli } from "./init.js";

// An error with an empty message of its own, like the AggregateError a driver throws when
// `localhost` refuses on both ::1 and 127.0.0.1 (#749). Each place below fails with one.
const INNER = ["connect ECONNREFUSED ::1:5432", "connect ECONNREFUSED 127.0.0.1:5432"];
const messageless = (): AggregateError => new AggregateError(INNER.map((message) => new Error(message)), "");

const fail: { generate?: unknown; loadSchema?: unknown; writeConfig?: unknown } = {};

vi.mock("@askdb/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/client")>();
  return {
    ...actual,
    createAskDb: (options: Parameters<typeof actual.createAskDb>[0]) => {
      const askdb = actual.createAskDb(options);
      return { ...askdb, ask: (...args: Parameters<typeof askdb.ask>) => (fail.generate ? Promise.reject(fail.generate) : askdb.ask(...args)) };
    },
  };
});

vi.mock("@askdb/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/core")>();
  return {
    ...actual,
    loadSchema: (...args: Parameters<typeof actual.loadSchema>) => {
      if (fail.loadSchema) throw fail.loadSchema;
      return actual.loadSchema(...args);
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (fail.writeConfig && String(args[0]).endsWith("askdb.config.ts")) throw fail.writeConfig;
      return actual.writeFileSync(...args);
    },
  };
});

const FIXTURE_DIR = resolve(import.meta.dirname, "../../../fixtures/schemas/orders-users.schema");

let stderr = "";
let dir: string;
let cwd: string;

beforeEach(() => {
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "askdb-error-detail-"));
  process.chdir(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  resetAskDbRuntimeForTests();
  delete fail.generate;
  delete fail.loadSchema;
  delete fail.writeConfig;
});

describe("an error with no message of its own is reported by its inner errors", () => {
  function writeAskConfig(): void {
    const config = {
      ai: { provider: "openai", providerConfig: { openai: {} } },
      introspection: { provider: "postgres", providerConfig: { postgres: {} } },
    };
    writeFileSync(join(dir, "askdb.config.mjs"), `export default ${JSON.stringify(config)};\n`);
  }

  it("askdb ask logs them as the run error's errMessage", async () => {
    writeAskConfig();
    fail.generate = messageless();
    const logFile = join(dir, "ask.log");

    const code = await runAskCli(["-q", "Which users?", "--schema", FIXTURE_DIR, "--mock-sql", "SELECT 1", "--log-file", logFile]);

    expect(code).toBe(1);
    const runError = readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event?: string; errMessage?: string })
      .find((entry) => entry.event === "askdb.run.error");
    expect(runError?.errMessage).toBe(INNER.join("\n"));
  });

  it("askdb ask prints them after Details: when the schema fails to load", async () => {
    writeAskConfig();
    fail.loadSchema = messageless();

    expect(await runAskCli(["-q", "Which users?", "--schema", FIXTURE_DIR, "--mock-sql", "SELECT 1"])).toBe(1);

    expect(stderr).toContain(`\nDetails: ${INNER.join("\n")}\n`);
  });

  it("askdb init prints them when it can't write the config", async () => {
    writeFileSync(join(dir, "package.json"), '{ "name": "app", "private": true }\n');
    fail.writeConfig = messageless();

    expect(await runInitCli(["--yes", "--skip-install"])).toBe(1);

    expect(stderr).toBe(`Failed to write config: ${INNER.join("\n")}\n`);
  });
});

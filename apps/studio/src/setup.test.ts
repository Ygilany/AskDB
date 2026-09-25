import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAskDbRuntimeForTests } from "@askdb/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SetupError, setSetupInstallerForTests, writeSetupConfig, type SetupConfigInput } from "./setup.js";

// A value that would break out of a `"${...}"` string literal and run code
// when the generated askdb.config.ts is loaded (via jiti) by Studio.
const HOSTILE = 'x", injected: (() => { throw new Error("pwned"); })(), y: "\\';

/** Loose shape for walking the evaluated config object in assertions. */
type ConfigTree = { readonly [key: string]: ConfigTree };

describe("writeSetupConfig escaping (config code injection)", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    // Never run a real install; returning false also skips loading the config.
    setSetupInstallerForTests(() => false);
  });

  afterEach(() => {
    setSetupInstallerForTests(undefined);
    resetAskDbRuntimeForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function write(input: SetupConfigInput): { source: string; config: ConfigTree } {
    const dir = mkdtempSync(join(tmpdir(), "askdb-setup-escape-"));
    dirs.push(dir);
    const result = writeSetupConfig(dir, input);
    const source = readFileSync(result.configPath, "utf8");
    return { source, config: evaluateGeneratedConfig(source) as ConfigTree };
  }

  it("emits quotes and backslashes in sqlite paths as literal strings", () => {
    const { config } = write({
      database: "sqlite",
      sqliteFile: `./data/${HOSTILE}.db`,
      schemaOut: `./out/${HOSTILE}`,
      aiProvider: "openai",
      studioExecute: true,
      studioExecuteSqliteFile: `./exec/${HOSTILE}.db`,
    });
    expect(config.introspection.providerConfig.sqlite.file).toBe(`./data/${HOSTILE}.db`);
    expect(config.introspection.outputDir).toBe(`./out/${HOSTILE}`);
    expect(config.studio.execute.file).toBe(`./exec/${HOSTILE}.db`);
    expect(Object.keys(config).sort()).toEqual(["ai", "introspection", "rag", "studio"]);
    expect(Object.keys(config.introspection).sort()).toEqual(["outputDir", "provider", "providerConfig"]);
    expect(Object.keys(config.introspection.providerConfig.sqlite)).toEqual(["file"]);
    expect(Object.keys(config.studio.execute).sort()).toEqual(["enabled", "file", "provider"]);
    // Choosing Studio execute in the wizard must actually turn it on (it is opt-in).
    expect(config.studio.execute.enabled as unknown).toBe(true);
  });

  it("emits quotes and backslashes in the prisma schema path as a literal string", () => {
    const { config } = write({
      database: "prisma",
      prismaSchema: `./prisma/${HOSTILE}.prisma`,
      schemaOut: `./askdb\\win\\"path"`,
      aiProvider: "anthropic",
    });
    expect(config.introspection.providerConfig.prisma).toEqual({ schemaPath: `./prisma/${HOSTILE}.prisma` });
    expect(config.introspection.outputDir).toBe(`./askdb\\win\\"path"`);
    expect(Object.keys(config).sort()).toEqual(["ai", "introspection", "rag"]);
  });

  it.each(["schemaOut", "sqliteFile", "studioExecuteSqliteFile"] as const)(
    "rejects control characters (newline, CR, NUL, U+2028) in %s",
    (field) => {
      for (const bad of ["./a\nb", "./a\rb", "./a\0b", "./a\u2028b", "./a\tb"]) {
        const dir = mkdtempSync(join(tmpdir(), "askdb-setup-escape-"));
        dirs.push(dir);
        expect(() =>
          writeSetupConfig(dir, {
            database: "sqlite",
            aiProvider: "openai",
            studioExecute: field === "studioExecuteSqliteFile",
            [field]: bad,
          }),
        ).toThrow(SetupError);
      }
    },
  );

  it("rejects a newline in the prisma schema path", () => {
    const dir = mkdtempSync(join(tmpdir(), "askdb-setup-escape-"));
    dirs.push(dir);
    expect(() =>
      writeSetupConfig(dir, { database: "prisma", aiProvider: "openai", prismaSchema: './schema.prisma"\n, x: 1, y: "' }),
    ).toThrow(SetupError);
  });

  it("rejects env names that aren't plain identifiers", () => {
    const dir = mkdtempSync(join(tmpdir(), "askdb-setup-escape-"));
    dirs.push(dir);
    expect(() =>
      writeSetupConfig(dir, { database: "postgres", aiProvider: "openai", connectionEnv: 'DATABASE_URL"), x: ("' }),
    ).toThrow(SetupError);
  });

  it("rejects unknown enum values that would be emitted as object keys or literals", () => {
    const dir = mkdtempSync(join(tmpdir(), "askdb-setup-escape-"));
    dirs.push(dir);
    expect(() =>
      writeSetupConfig(dir, { database: "postgres", aiProvider: "constructor" as never, aiKeyEnv: "KEY" }),
    ).toThrow(SetupError);
    expect(() =>
      writeSetupConfig(dir, {
        database: "prisma",
        aiProvider: "openai",
        studioExecute: true,
        studioExecuteProvider: HOSTILE as never,
        studioExecuteConnectionEnv: "DATABASE_URL",
      }),
    ).toThrow(SetupError);
  });
});

/**
 * Evaluate a generated `askdb.config.ts` with stubbed `defineConfig` / `env`,
 * so tests assert on the object the config actually produces. A successful
 * injection would throw "pwned" here or add extra keys.
 */
function evaluateGeneratedConfig(source: string): unknown {
  const body = source
    .replace(/^import .*$/m, "")
    .replace("export default defineConfig(", "return defineConfig(")
    .replace(/\}\s*satisfies AskDbConfig\);\s*$/, "});");
  return new Function("defineConfig", "env", body)(
    (config: unknown) => config,
    (name: string) => ({ env: name }),
  );
}

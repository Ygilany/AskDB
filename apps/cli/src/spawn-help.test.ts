import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs dist/cli.js: turbo's `test` task depends on this package's `build`, so dist is current.
const cliJs = join(import.meta.dirname, "../../..", "apps/cli/dist/cli.js");

/**
 * Names a user might set in the shell that AskDB never reads from there. Settings come from
 * askdb.config.ts (bound to a variable with `env("…")`); `ASKDB_DEBUG` is the one AskDB variable
 * read from the environment, so it's allowed.
 */
const UNREAD_ENV_NAME = /\b(?:ASKDB_(?!DEBUG\b)[A-Z0-9_]+|DATABASE_URL|OPENAI_API_KEY|OPENAI_MODEL)\b/;

describe("askdb help text (#281)", () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = mkdtempSync(join(tmpdir(), "askdb-cli-help-"));
  });

  afterAll(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  function help(args: string[]): string {
    const exec = spawnSync("node", [cliJs, ...args], { cwd: emptyDir, encoding: "utf8" });
    expect(exec.status, exec.stderr).toBe(0);
    return exec.stdout;
  }

  it.each([
    [["ask", "--help"], ["modes.askdbMode", "dev.mockSql", "logging.correlationId"]],
    [["introspect", "--help"], ["introspection.outputDir", "introspection.providerConfig.<engine>.databaseUrl"]],
  ])("`askdb %j` names the askdb.config keys, not environment variables nothing reads", (args, configKeys) => {
    const text = help(args);
    expect(text).not.toMatch(UNREAD_ENV_NAME);
    for (const key of configKeys) expect(text).toContain(key);
  });

  it("`askdb introspect --help` lists every flag the CLI reference documents, and each flag it lists parses", () => {
    // The flags `reference/cli.mdx` documents for `askdb introspect`, plus its shared logging flags.
    const documented = [
      "--url", "--engine", "--prisma-schema", "--from-export", "--out", "--schema-id", "--schemas",
      "--exclude-schemas", "--tables", "--print", "--diff",
      "-v", "--verbose", "--log-level", "--log-file", "--log-stdout", "--correlation-id",
    ];
    // Each Options line starts with its spellings ("-v, --verbose"), then a <value> placeholder when it takes one.
    const listed = (help(["introspect", "--help"]).split("\nOptions:\n")[1] ?? "")
      .split("\n")
      .map((line) => /^ {2}(-[^<]+?)(?: (<[^>]+>))?(?: {2,}|$)/.exec(line))
      .filter((match) => match !== null)
      .map(([, names, value]) => ({ names: names!.split(", "), takesValue: value !== undefined }));

    expect(listed.flatMap((flag) => flag.names)).toEqual(expect.arrayContaining(documented));
    for (const { names, takesValue } of listed) {
      for (const name of names) {
        // `templates` parses every flag without needing askdb.config, so a rejected flag shows here.
        const args = ["introspect", "templates", "--engine", "postgres", name, ...(takesValue ? ["x"] : [])];
        const exec = spawnSync("node", [cliJs, ...args], { cwd: emptyDir, encoding: "utf8" });
        expect(exec.stderr, name).not.toContain("Unknown option");
      }
    }
  });
});

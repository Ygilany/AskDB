import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const cliDir = join(repoRoot, "apps/cli");
const cliJs = join(cliDir, "dist/cli.js");
const cliVersion = (JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")) as { version: string })
  .version;
const DEBUG_HINT = "Set ASKDB_DEBUG=1 to print the stack trace.";
const STACK_FRAME = /\n\s+at /;

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("node", [cliJs, ...args], {
    cwd,
    // Undefined values are dropped from the child env, so an inherited switch can't leak in.
    env: { ...process.env, ASKDB_DEBUG: undefined, DEBUG: undefined, ...env },
    encoding: "utf8",
  });
}

// These tests execute dist/cli.js; turbo's `test` task depends on this package's own
// `build` (and `^build`), so dist is current without rebuilding inside the tests —
// in-test rebuilds raced with parallel test files reading dist.
describe("cli spawn: first run outside a project (no askdb.config)", () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = mkdtempSync(join(tmpdir(), "askdb-cli-empty-"));
  });

  afterAll(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it.each([
    [["--help"], "Usage: askdb"],
    [["-h"], "Usage: askdb"],
    [["help", "ask"], "Usage: askdb ask"],
    // Unlike `help ask`, this parses `ask` itself, so it fails if config loads before commander's help check.
    [["ask", "--help"], "Usage: askdb ask"],
    [["introspect", "--help"], "askdb introspect - Schema introspection"],
    [["introspect", "templates", "--engine", "postgres"], "-- schemas"],
    [["studio", "--help"], "askdb-studio - Local browser UI"],
    [["rag"], "askdb rag - "],
    [["rag", "--help"], "askdb rag - "],
    [["rag", "-h"], "askdb rag - "],
  ])("`askdb %j` works without a config", (args, expected) => {
    const exec = run(args, emptyDir);
    expect(exec.stderr).toBe("");
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain(expected);
  });

  it.each([
    [["--version"]],
    [["-V"]],
    [["introspect", "--version"]],
    [["introspect", "-V"]],
    [["rag", "--version"]],
    [["rag", "-V"]],
  ])(
    "`askdb %j` prints the package version and exits 0",
    (args) => {
      const exec = run(args, emptyDir);
      expect(exec.status).toBe(0);
      expect(exec.stdout.trim()).toBe(cliVersion);
      expect(exec.stderr).toBe("");
    },
  );

  it("`askdb bundle` works without a config", () => {
    const out = join(emptyDir, "bundle.json");
    const exec = run(["bundle", join(repoRoot, "fixtures/schemas/orders-users.schema"), "--out", out], emptyDir);
    expect(exec.stderr).toBe("");
    expect(exec.status).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it.each([[["ask", "-q", "x"]], [["introspect"]], [["rag", "index", "x"]]])(
    "`askdb %j` prints the missing-config message without a stack trace",
    (args) => {
      const exec = run(args, emptyDir);
      expect(exec.status).toBe(1);
      // process.cwd() in the child is the resolved path (e.g. /private/var/... on macOS).
      expect(exec.stderr.trim()).toBe(
        `No askdb.config.* or .config/askdb.* found in ${realpathSync(emptyDir)}. Run \`npx askdb init\` to create one.`,
      );
    },
  );
});

describe("cli spawn: a config that fails to load", () => {
  let brokenDir: string;

  beforeAll(() => {
    brokenDir = mkdtempSync(join(tmpdir(), "askdb-cli-broken-"));
    writeFileSync(join(brokenDir, "askdb.config.ts"), "export default {{{ broken\n", "utf8");
  });

  afterAll(() => {
    rmSync(brokenDir, { recursive: true, force: true });
  });

  // `DEBUG` belongs to the `debug` npm package, so it must not switch on AskDB stack traces.
  it.each([
    [{}, false],
    [{ ASKDB_DEBUG: "0" }, false],
    [{ DEBUG: "*" }, false],
    [{ ASKDB_DEBUG: "1" }, true],
    [{ ASKDB_DEBUG: "true" }, true],
  ])("with env %j, prints the stack trace: %s", (env, withStack) => {
    const exec = run(["ask", "-q", "x"], brokenDir, env);
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain(join(realpathSync(brokenDir), "askdb.config.ts"));
    if (withStack) {
      expect(exec.stderr).toMatch(STACK_FRAME);
      expect(exec.stderr).not.toContain(DEBUG_HINT);
    } else {
      expect(exec.stderr).not.toMatch(STACK_FRAME);
      expect(exec.stderr.trimEnd().endsWith(DEBUG_HINT)).toBe(true);
    }
  });

  it("`askdb studio` warns that it is ignoring the config instead of starting silently", () => {
    // An explicit missing --schema makes Studio exit before it listens.
    const exec = run(["studio", "--schema", "./missing"], brokenDir);
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain(
      `askdb-studio: warning: ${join(realpathSync(brokenDir), "askdb.config.ts")} could not be loaded, so Studio is ignoring it: `,
    );
  });
});

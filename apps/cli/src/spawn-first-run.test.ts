import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const cliDir = join(repoRoot, "apps/cli");
const cliJs = join(cliDir, "dist/cli.js");
const cliVersion = (JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")) as { version: string })
  .version;

function run(args: string[], cwd: string) {
  return spawnSync("node", [cliJs, ...args], {
    cwd,
    env: { ...process.env, DEBUG: "" },
    encoding: "utf8",
  });
}

describe("cli spawn: first run outside a project (no askdb.config)", () => {
  let emptyDir: string;

  beforeAll(() => {
    const build = spawnSync("pnpm", ["-C", cliDir, "build"], { cwd: repoRoot, encoding: "utf8" });
    expect(build.status).toBe(0);
    emptyDir = mkdtempSync(join(tmpdir(), "askdb-cli-empty-"));
  });

  afterAll(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it.each([["--help"], ["-h"]])("`askdb %s` prints usage and exits 0", (flag) => {
    const exec = run([flag], emptyDir);
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("Usage: askdb");
    expect(exec.stdout).toContain("ask");
    expect(exec.stderr).toBe("");
  });

  it.each([["--version"], ["-V"]])("`askdb %s` prints the package version and exits 0", (flag) => {
    const exec = run([flag], emptyDir);
    expect(exec.status).toBe(0);
    expect(exec.stdout.trim()).toBe(cliVersion);
    expect(exec.stderr).toBe("");
  });

  it("`askdb help ask` works without a config", () => {
    const exec = run(["help", "ask"], emptyDir);
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("Usage: askdb ask");
  });

  it("`askdb ask` prints a friendly missing-config message without a stack trace", () => {
    const exec = run(["ask", "-q", "x"], emptyDir);
    expect(exec.status).toBe(1);
    // process.cwd() in the child is the resolved path (e.g. /private/var/... on macOS).
    expect(exec.stderr.trim()).toBe(
      `No askdb.config.* found in ${realpathSync(emptyDir)}. Run \`npx askdb init\` to create one.`,
    );
  });

  it("`askdb introspect` without a config prints the same friendly message", () => {
    const exec = run(["introspect"], emptyDir);
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("No askdb.config.* found in");
    expect(exec.stderr).not.toMatch(/\n\s+at /);
  });

  it("`askdb introspect --help` works without a config", () => {
    const exec = run(["introspect", "--help"], emptyDir);
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("askdb introspect");
  });
});

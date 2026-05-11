import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const cliDir = join(repoRoot, "apps/cli");
const corePkgDir = join(repoRoot, "packages/core");
const introspectDir = join(repoRoot, "packages/introspect");
const postgresDir = join(repoRoot, "packages/postgres");

describe("cli spawn: introspect subcommand", () => {
  it("runs `askdb introspect templates` via the in-tree Postgres connector", () => {
    expect(run("pnpm", ["-C", corePkgDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", introspectDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", postgresDir, "build"]).status).toBe(0);
    expect(run("pnpm", ["-C", cliDir, "build"]).status).toBe(0);

    const exec = run("node", [
      join(cliDir, "dist/cli.js"),
      "introspect",
      "templates",
      "--engine",
      "postgres",
    ]);

    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain("-- schemas");
    expect(exec.stdout).toContain("ORDER BY");
  });
});

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

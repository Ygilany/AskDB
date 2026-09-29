import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { listBuiltinAiProviderSetups } from "@askdb/ai";
import { ASKDB_AI_PROVIDERS } from "@askdb/config";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const cli = join(repoRoot, "apps/cli/dist/cli.js");

// dist/cli.js is built by turbo before this runs (`test` depends on `build`). The CLI loads
// the repo-root askdb.config.ts on startup, as introspect-shim.test.ts relies on too.
describe("askdb help init", () => {
  it("lists every AI provider `askdb init` accepts under --ai-provider", () => {
    const exec = spawnSync("node", [cli, "help", "init"], { cwd: repoRoot, encoding: "utf8" });
    expect(exec.status).toBe(0);
    const line = exec.stdout.split("\n").find((l) => l.includes("--ai-provider"));
    const ids = listBuiltinAiProviderSetups(ASKDB_AI_PROVIDERS).map((setup) => setup.id);
    expect(line).toContain(ids.join("|"));
  });
});

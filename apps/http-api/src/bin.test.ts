import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Runs dist/bin.js: turbo's `test` task depends on this package's `build`, so dist is current.
const repoRoot = join(import.meta.dirname, "../../..");
const bin = join(repoRoot, "apps/http-api/dist/bin.js");

function runBin(args: string[], cwd: string) {
  return spawnSync("node", [bin, ...args], { cwd, encoding: "utf8", timeout: 20_000 });
}

describe("askdb-http startup errors", () => {
  let holder: Server | undefined;
  let scratch: string | undefined;

  afterEach(async () => {
    if (holder) await new Promise<void>((resolve) => holder!.close(() => resolve()));
    holder = undefined;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it("prints one line and exits 1 when the port is already in use", async () => {
    holder = createServer();
    await new Promise<void>((resolve) => holder!.listen(0, "127.0.0.1", resolve));
    const address = holder.address();
    if (!address || typeof address === "string") throw new Error("expected inet address");

    const run = runBin(["--port", String(address.port), "--host", "127.0.0.1"], repoRoot);

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      `askdb-http: cannot listen on 127.0.0.1:${address.port} — address already in use. Pick another port with --port or httpApi.listen.port.\n`,
    );
    expect(run.stdout).toBe("");
  });

  it("prints one line and exits 1 when the config sets an out-of-range httpApi.requestTimeoutMs", () => {
    scratch = mkdtempSync(join(tmpdir(), "askdb-http-bin-"));
    // So `import "@askdb/config"` in askdb.config.ts resolves when askdb-http loads it.
    mkdirSync(join(scratch, "node_modules/@askdb"), { recursive: true });
    symlinkSync(join(repoRoot, "packages/config"), join(scratch, "node_modules/@askdb/config"));
    writeFileSync(
      join(scratch, "askdb.config.ts"),
      `import { defineConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
  httpApi: { requestTimeoutMs: 5e9 },
});
`,
    );

    const run = runBin([], scratch);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^askdb-http: askdb\.config: invalid httpApi\.requestTimeoutMs .*at most 2147483647.*\n$/);
    expect(run.stderr.trimEnd()).not.toContain("\n");
  });

  it("prints one line and exits 1 when the config can't be loaded", () => {
    scratch = mkdtempSync(join(tmpdir(), "askdb-http-bin-"));

    const run = runBin([], scratch);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^askdb-http: No askdb\.config\.\* .*\n$/);
    expect(run.stderr.trimEnd()).not.toContain("\n");
  });
});

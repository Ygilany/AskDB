import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it.each(["0x50", "0b1010000", "0o120", "1e3", "80.0", "+80", " 80 ", "abc", "65536"])(
    "exits 1 at the flag check for non-decimal --port %s",
    (raw) => {
      scratch = mkdtempSync(join(tmpdir(), "askdb-http-bin-"));
      const run = runBin(["--port", raw], scratch);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`askdb-http: Invalid --port: ${raw}\n`);
      // The failure is at the flag check, before any config loads.
      expect(run.stderr).not.toContain("No askdb.config");
      expect(run.stdout).toBe("");
    },
  );

  it.each(["0", "1", "3000", "65535", "080"])(
    "passes the flag check for decimal --port %s",
    (raw) => {
      scratch = mkdtempSync(join(tmpdir(), "askdb-http-bin-"));
      const run = runBin(["--port", raw], scratch);
      expect(run.status).toBe(1);
      // Reaching the config load proves the flag check passed.
      expect(run.stderr).toMatch(/^askdb-http: No askdb\.config\.\* .*\n$/);
      expect(run.stdout).toBe("");
    },
  );

  it("prints a bracketed, parseable listening URL for an IPv6 host", async () => {
    // The bin prints the configured port (the bound-port fix is #1038), so pick a
    // free port first: port 0 would print `:0`, which is not a reachable URL.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "::1", resolve));
    const probeAddress = probe.address();
    if (!probeAddress || typeof probeAddress === "string") throw new Error("expected inet address");
    const port = probeAddress.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    scratch = mkdtempSync(join(tmpdir(), "askdb-http-bin-"));
    writeFileSync(
      join(scratch, "askdb.config.mjs"),
      `export default {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
};
`,
    );

    const child = spawn(process.execPath, [bin, "--host", "::1", "--port", String(port)], {
      cwd: scratch,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      const url = await vi.waitFor(
        () => {
          const listeningUrl = stdout.match(/^AskDB HTTP API listening on (http:\/\/\[::1\]:\d+)\r?$/m)?.[1];
          if (!listeningUrl) throw new Error(`Startup URL was not printed. ${stderr}`);
          return new URL(listeningUrl);
        },
        { timeout: 10_000 },
      );

      expect(url.port).toBe(String(port));
      const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(5_000) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      child.kill();
      await closed;
    }
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
    expect(run.stderr).toMatch(
      /^askdb-http: AskDB config at .*askdb\.config\.ts: invalid httpApi\.requestTimeoutMs .*at most 2147483647.*\n$/,
    );
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

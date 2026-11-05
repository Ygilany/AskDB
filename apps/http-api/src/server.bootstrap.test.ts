import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Runs dist/index.js in a child process, as an embedding host would: turbo's `test` task
// depends on this package's `build`, so dist is current. A child process gives each case its
// own working directory and a fresh AskDB runtime.
const repoRoot = join(import.meta.dirname, "../../..");
const entry = pathToFileURL(join(repoRoot, "apps/http-api/dist/index.js")).href;
const schemaDir = join(repoRoot, "fixtures/schemas/orders-users.schema");

const scratchDirs: string[] = [];

/** A project directory with an `askdb.config.ts` whose mock model answers `mockSql`. */
function makeProject(mockSql: string): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-http-host-"));
  scratchDirs.push(dir);
  // So `import "@askdb/config"` resolves, in askdb.config.ts and in the host script.
  mkdirSync(join(dir, "node_modules/@askdb"), { recursive: true });
  symlinkSync(join(repoRoot, "packages/config"), join(dir, "node_modules/@askdb/config"));
  writeFileSync(
    join(dir, "askdb.config.ts"),
    `import { defineConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
  host: { schemaPath: ${JSON.stringify(schemaDir)} },
  dev: { mockSql: ${JSON.stringify(mockSql)} },
  logging: { level: "silent" },
});
`,
  );
  return dir;
}

/**
 * Run `setup` as a host module in `cwd`, then build the server, start it and post one question.
 * Prints `{ status, body }` from `POST /ask`, or `{ thrown }` when building the server throws.
 */
function runHost(cwd: string, setup = ""): { status?: number; body?: any; thrown?: string } {
  const script = `
import { createAskDbHttpServer } from ${JSON.stringify(entry)};
${setup}
let app;
try {
  app = createAskDbHttpServer({ port: 0 });
} catch (error) {
  process.stdout.write(JSON.stringify({ thrown: error.message }));
  process.exit(0);
}
await app.listen();
const { port } = app.server.address();
const res = await fetch(\`http://127.0.0.1:\${port}/ask\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "how many users?" }),
});
process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));
await app.close();
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (run.status !== 0) throw new Error(`host exited ${run.status}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe("createAskDbHttpServer config bootstrap", () => {
  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("loads askdb.config.* from the working directory when the host didn't bootstrap", () => {
    const project = makeProject("select 'from cwd'");

    const reply = runHost(project);

    expect(reply.status).toBe(200);
    expect(reply.body.sql).toBe("select 'from cwd'");
  });

  it("keeps the runtime a host bootstrapped first, even when the working directory has another config", () => {
    const hostProject = makeProject("select 'from host'");
    const cwdProject = makeProject("select 'from cwd'");

    const reply = runHost(
      cwdProject,
      `import { bootstrapAskDbEnv } from "@askdb/config";
bootstrapAskDbEnv({ cwd: ${JSON.stringify(hostProject)} });`,
    );

    expect(reply.status).toBe(200);
    expect(reply.body.sql).toBe("select 'from host'");
  });

  it("throws the config error when it is built, not on the first request, when no config is found", () => {
    const empty = mkdtempSync(join(tmpdir(), "askdb-http-host-"));
    scratchDirs.push(empty);

    const reply = runHost(empty);

    expect(reply.thrown).toMatch(/^No askdb\.config\.\* or \.config\/askdb\.\* found under /);
  });
});

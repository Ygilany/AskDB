/**
 * The installed `askdb-http` in a project that installed no database driver.
 *
 * Protects: the deploy guide's install line, `@askdb/http-api @askdb/postgres ai
 * @ai-sdk/openai` (`guides/deploy-as-http-service.mdx`), gives a server that starts and
 * answers `GET /health`, with no `pg` anywhere in the install. The docs call the drivers
 * optional peers, needed only for live introspection or your own execution
 * (`guides/switch-engines.mdx`, `reference/packages.mdx`); the HTTP API does neither.
 * Catches: `@askdb/http-api` (or anything it pulls in) depending on `pg` again, which
 * forced the driver on every install (#260), or the bin importing a driver at startup, so
 * that it crashes when the driver is absent.
 * Not covered elsewhere: the lab's own install has `pg` (the host executes SQL with it),
 * so its `askdb-http` can't show that. `pnpm smoke:install` installs `@askdb/http-api`
 * without `pg`, but with npm, and it only runs `askdb-http --help`, which exits before
 * the config bootstrap and the server start.
 * No production seam: a separate pnpm project that installs the target's packages the way
 * the deploy guide says, plus the documented bin, flags and route.
 *
 * The project is a fresh pnpm root in the system temp directory: inside the lab, Node's
 * resolution would walk up to the lab's own `node_modules/pg`. It pins every `@askdb/*`
 * package to the lab's install target with the lab's overrides block, as `lab:use` does.
 * `pg` is shown absent twice: no `pg` package in its lockfile, and `pg` doesn't resolve
 * from the installed `@askdb/postgres` or `@askdb/http-api`.
 *
 * Needs the `http-api-optional-drivers` capability: a target whose `@askdb/http-api`
 * still depends on a driver (the published 1.0.0-beta.42 depends on `pg`) reports
 * `n/a (capability: http-api-optional-drivers)`.
 *
 * Needs an installed lab (`pnpm lab:use .`) and the registry, for the third-party packages.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { needsCapability } from "../../src/capabilities.js";
import { startHttpServer, type HttpServer } from "../../src/http-api.js";
import { LAB_ROOT } from "../../src/paths.js";

/** The deploy guide's install line (`<InstallTabs pkgs="…" />`). */
const DEPLOY_GUIDE_PACKAGES = ["@askdb/http-api", "@askdb/postgres", "ai", "@ai-sdk/openai"];

const project = mkdtempSync(join(tmpdir(), "lab-http-no-pg-"));
let http: HttpServer | undefined;

afterAll(async () => {
  await http?.close();
  rmSync(project, { recursive: true, force: true });
});

/** The lab's `@askdb/*` pins (its `lab:use` overrides block), with tarball paths made absolute. */
function labPins(): Map<string, string> {
  const ws = readFileSync(join(LAB_ROOT, "pnpm-workspace.yaml"), "utf8");
  const pins = [...ws.matchAll(/^ {2}"([^"]+)": "([^"]+)"$/gm)].map(([, name, spec]) => {
    const path = spec!.startsWith("file:") ? spec!.slice("file:".length) : undefined;
    return [name!, path && !isAbsolute(path) ? `file:${resolve(LAB_ROOT, path)}` : spec!] as const;
  });
  if (!pins.length) throw new Error("the lab's pnpm-workspace.yaml has no lab:use overrides; run `pnpm lab:use <target>`");
  return new Map(pins);
}

/** Every package in a pnpm lockfile's `packages:` section, as `{ name, spec }`: a version, or `file:<tarball>`. */
function lockedPackages(lockfile: string): { name: string; spec: string }[] {
  const start = lockfile.indexOf("\npackages:\n");
  if (start < 0) throw new Error("the project's pnpm-lock.yaml has no packages section");
  const end = lockfile.indexOf("\nsnapshots:\n", start);
  const section = lockfile.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^ {2}'?((?:@[\w.-]+\/)?[\w.-]+)@([^'\n]+?)'?:$/gm)].map((m) => ({ name: m[1]!, spec: m[2]! }));
}

/** Whether a locked `@askdb/*` spec is the lab target's pin: the same tarball, or the same version. */
function fromTarget(locked: string, pin: string | undefined): boolean {
  if (!pin) return false;
  if (pin.startsWith("file:")) return locked.startsWith("file:") && basename(locked) === basename(pin);
  return locked === pin;
}

function resolvesFrom(packageDir: string, request: string): boolean {
  try {
    createRequire(join(realpathSync(packageDir), "package.json")).resolve(request);
    return true;
  } catch {
    return false;
  }
}

describe("[postgres] http-no-pg", () => {
  it("askdb-http starts and serves /health in an install with no pg", async (ctx) => {
    needsCapability(ctx, "http-api-optional-drivers");
    const pins = labPins();
    const lab = JSON.parse(readFileSync(join(LAB_ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const dependencies = Object.fromEntries(DEPLOY_GUIDE_PACKAGES.map((name) => [name, pins.get(name) ?? lab.dependencies[name]!]));
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "lab-http-no-pg", private: true, type: "module", dependencies }, null, 2));
    writeFileSync(join(project, "pnpm-workspace.yaml"), `overrides:\n${[...pins].map(([name, spec]) => `  "${name}": "${spec}"`).join("\n")}\n`);
    writeFileSync(
      join(project, "askdb.config.ts"),
      `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "lab-no-key" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
});
`,
    );
    execFileSync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: project, stdio: "pipe" });

    const locked = lockedPackages(readFileSync(join(project, "pnpm-lock.yaml"), "utf8"));
    const askdb = locked.filter((p) => p.name === "askdb" || p.name.startsWith("@askdb/"));
    expect(askdb.map((p) => p.name)).toContain("@askdb/http-api");
    // Every AskDB package came from the lab's install target, as `lab:use` checks for the lab.
    expect(askdb.filter((p) => !fromTarget(p.spec, pins.get(p.name)))).toEqual([]);
    expect(locked.map((p) => p.name)).not.toContain("pg");
    for (const pkg of ["@askdb/http-api", "@askdb/postgres"]) expect(resolvesFrom(join(project, "node_modules", pkg), "pg"), `pg resolves from ${pkg}`).toBe(false);

    http = await startHttpServer({ cwd: project, bin: join(project, "node_modules", ".bin", "askdb-http") });
    const res = await fetch(`${http.url}/health`);

    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
  });
});

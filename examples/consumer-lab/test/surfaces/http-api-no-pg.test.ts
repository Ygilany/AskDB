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
 * The project is a fresh pnpm root in the system temp directory (`src/fresh-project.ts`):
 * inside the lab, Node's resolution would walk up to the lab's own `node_modules/pg`. It
 * pins every `@askdb/*` package to the lab's install target with the lab's overrides
 * block, as `lab:use` does.
 * `pg` is shown absent twice: no `pg` package in its lockfile, and `pg` doesn't resolve
 * from the installed `@askdb/postgres` or `@askdb/http-api`.
 *
 * Needs the `http-api-optional-drivers` capability: a target whose `@askdb/http-api`
 * still depends on a driver (the published 1.0.0-beta.42 depends on `pg`) reports
 * `n/a (capability: http-api-optional-drivers)`.
 *
 * Needs an installed lab (`pnpm lab:use .`) and the registry, for the third-party packages.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { needsCapability } from "../../src/capabilities.js";
import { fromTarget, installFreshProject, labPins, lockedPackages, resolvesFrom } from "../../src/fresh-project.js";
import { startHttpServer, type HttpServer } from "../../src/http-api.js";

/** The deploy guide's install line (`<InstallTabs pkgs="…" />`). */
const DEPLOY_GUIDE_PACKAGES = ["@askdb/http-api", "@askdb/postgres", "ai", "@ai-sdk/openai"];

const project = mkdtempSync(join(tmpdir(), "lab-http-no-pg-"));
let http: HttpServer | undefined;

afterAll(async () => {
  await http?.close();
  rmSync(project, { recursive: true, force: true });
});

describe("[postgres] http-no-pg", () => {
  it("askdb-http starts and serves /health in an install with no pg", async (ctx) => {
    needsCapability(ctx, "http-api-optional-drivers");
    const pins = labPins();
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
    const install = installFreshProject(project, "lab-http-no-pg", DEPLOY_GUIDE_PACKAGES);
    expect(install.status, install.stderr).toBe(0);

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

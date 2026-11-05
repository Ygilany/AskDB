/**
 * `pnpm add askdb` in a clean project, then the Prisma user's extra install.
 *
 * Protects: the install page's line for trying AskDB from the CLI, `askdb` alone
 * (`install.mdx`), exits 0 on pnpm 11 with no build approved, and installs no Prisma
 * package. `--engine prisma` then exits 1 naming `@askdb/prisma`, and works after the
 * Prisma guide's install (`guides/integrations/prisma.mdx`): `@askdb/prisma` with the
 * `@prisma/engines` build approved.
 * Catches: `askdb` or anything it pulls in (`@askdb/studio`) depending on `@askdb/prisma`
 * again, or any other new dependency with an install script, which makes the install exit 1
 * on pnpm 11 (`ERR_PNPM_IGNORED_BUILDS`, #259); and the CLI importing `@askdb/prisma` at
 * startup, which crashes it when the package is absent (#339).
 * Not covered elsewhere: the lab's own install approves `@prisma/engines` for its committed
 * baseline, and `pnpm smoke:install` installs with npm, which runs install scripts.
 * No production seam: a separate pnpm project that runs the documented commands.
 *
 * The project is a fresh pnpm root in the system temp directory (`src/fresh-project.ts`)
 * that pins every `@askdb/*` package but `@askdb/prisma` to the lab's install target and
 * approves no build. Pinning `@askdb/prisma` to a `file:` tarball would make pnpm install
 * `askdb`'s optional peer as a dependency.
 *
 * Needs the `askdb-optional-prisma` capability: a target whose `askdb` still depends on
 * `@askdb/prisma` (the published 1.0.0-beta.44 does) reports
 * `n/a (capability: askdb-optional-prisma)`.
 *
 * Needs an installed lab (`pnpm lab:use .`) and the registry, for the third-party packages.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { needsCapability } from "../../src/capabilities.js";
import { fromTarget, installFreshProject, labPins, lockedPackages, targetSpec } from "../../src/fresh-project.js";

const project = mkdtempSync(join(tmpdir(), "lab-askdb-no-prisma-"));

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

// Without the runner's NODE_PATH: pnpm's bin shim for vitest puts the lab's own store on it,
// where `@askdb/prisma` is installed, and the CLI's project-directory fallback would find it.
const askdb = (...args: string[]) =>
  spawnSync(join(project, "node_modules", ".bin", "askdb"), args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: undefined },
  });

describe("[postgres] askdb-no-prisma", () => {
  it("pnpm add askdb exits 0 with no build approved, and --engine prisma needs only @askdb/prisma", (ctx) => {
    needsCapability(ctx, "askdb-optional-prisma");
    const pins = labPins();

    const install = installFreshProject(project, "lab-askdb-no-prisma", ["askdb"], { unpinned: ["@askdb/prisma"] });

    expect(install.status, install.stderr).toBe(0);
    const locked = lockedPackages(readFileSync(join(project, "pnpm-lock.yaml"), "utf8"));
    expect(locked.filter((p) => p.name === "@askdb/prisma" || p.name.startsWith("@prisma/"))).toEqual([]);
    // Every AskDB package came from the lab's install target, as `lab:use` checks for the lab.
    expect(locked.filter((p) => (p.name === "askdb" || p.name.startsWith("@askdb/")) && !fromTarget(p.spec, pins.get(p.name)))).toEqual([]);

    // The CLI reads the project's config before it picks the engine.
    writeFileSync(
      join(project, "askdb.config.ts"),
      `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "lab-no-key" } } },
  introspection: { provider: "prisma", providerConfig: { prisma: {} } },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
});
`,
    );
    mkdirSync(join(project, "prisma"));
    writeFileSync(
      join(project, "prisma", "schema.prisma"),
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel Agency {\n  id   Int    @id\n  name String\n}\n',
    );
    const help = askdb("--help");
    expect(help.status, help.stderr).toBe(0);

    const missing = askdb("introspect", "--print");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("needs the optional peer dependency `@askdb/prisma`");

    // The Prisma guide's install: the package, with the @prisma/engines build approved.
    const add = spawnSync("pnpm", ["add", "--allow-build=@prisma/engines", `@askdb/prisma@${targetSpec("@askdb/prisma", pins)}`], {
      cwd: project,
      encoding: "utf8",
    });
    expect(add.status, add.stderr).toBe(0);
    const printed = askdb("introspect", "--print");
    expect(printed.status, printed.stderr).toBe(0);
    expect(printed.stdout).toContain('"Agency"');
  });
});

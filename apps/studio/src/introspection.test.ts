import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { inferSchemaId } from "./introspection.js";

const studioDir = join(import.meta.dirname, "..");
const work = realpathSync(mkdtempSync(join(tmpdir(), "askdb-studio-plan-")));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// Preloaded with --import: makes `@askdb/prisma` unresolvable, as in a project that never
// installed it. Studio's workspace install has it as a devDependency.
const HIDE_PRISMA = `
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@askdb/prisma") {
      throw Object.assign(new Error("Cannot find package '@askdb/prisma' imported from " + context.parentURL), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    }
    return nextResolve(specifier, context);
  },
});
`;

// Studio derives the schema id the same way `askdb introspect` does (#782):
// an output directory of `.`, `/` or `.schema` must fall back to
// "introspected", matching the CLI.
describe("inferSchemaId", () => {
  it.each([
    [".", "introspected"],
    ["./", "introspected"],
    ["/", "introspected"],
    [".schema", "introspected"],
    ["acme.schema", "acme"],
    ["askdb", "askdb"],
    ["/tmp/my-app.schema", "my-app"],
  ])("%s -> %s", (path, expected) => {
    expect(inferSchemaId(path)).toBe(expected);
  });
});

// `@askdb/prisma` is an optional peer of Studio (#259): with it missing, the plan for a
// Prisma config is an error the UI shows, with the install hint, not a thrown exception.
it("reports a missing @askdb/prisma as the Prisma plan's error", () => {
  const hook = join(work, "hide-prisma.mjs");
  writeFileSync(hook, HIDE_PRISMA, "utf8");
  const configUrl = pathToFileURL(createRequire(join(studioDir, "package.json")).resolve("@askdb/config")).href;
  const script = `
    const config = await import(${JSON.stringify(configUrl)});
    const structured = {
      ai: { provider: "openai", providerConfig: { openai: { apiKey: "test-key" } } },
      introspection: { provider: "prisma", providerConfig: { prisma: { schemaPath: "./schema.prisma" } } },
      rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
    };
    config.setAskDbRuntimeForTests(structured);
    const { resolveStudioIntrospectionPlan } = await import(${JSON.stringify(pathToFileURL(join(studioDir, "dist/introspection.js")).href)});
    console.log(JSON.stringify(await resolveStudioIntrospectionPlan()));
  `;

  const run = spawnSync(
    process.execPath,
    ["--no-warnings", "--import", pathToFileURL(hook).href, "--input-type=module", "-e", script],
    { cwd: work, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
  );

  expect(run.status, run.stderr).toBe(0);
  const plan = JSON.parse(run.stdout) as { ok: boolean; engine: string; error: string };
  expect(plan).toMatchObject({ ok: false, engine: "prisma" });
  expect(plan.error).toContain("needs the optional peer dependency `@askdb/prisma`");
});

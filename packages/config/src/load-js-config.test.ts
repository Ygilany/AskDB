import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAskDbConfigProjection, loadAskDbConfigProjectionSync } from "./index.js";

// Inside an app's bundle jiti can't start: webpack 5 fails in createJiti, and esbuild can't find
// jiti's transpiler (#833). A JavaScript config has to load without it.
vi.mock("jiti", () => ({
  createJiti: () => {
    throw new TypeError("i.createRequire is not a function");
  },
}));

const DB_URL = "postgres://localhost/js";
const AI = `ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } } }`;
const BLOCKS = `${AI}, introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "${DB_URL}" } } }`;

const JS_CONFIGS: [string, Record<string, string>][] = [
  ["askdb.config.mjs", { "askdb.config.mjs": `export default { ${BLOCKS} };\n` }],
  ["askdb.config.cjs", { "askdb.config.cjs": `module.exports = { ${BLOCKS} };\n` }],
  ["askdb.config.js in an ES module package", { "package.json": '{ "type": "module" }\n', "askdb.config.js": `export default { ${BLOCKS} };\n` }],
  ["askdb.config.js in a CommonJS package", { "package.json": '{ "type": "commonjs" }\n', "askdb.config.js": `module.exports = { ${BLOCKS} };\n` }],
  [
    "askdb.config.mjs that default-imports a CommonJS module",
    {
      "url.cjs": `module.exports = { url: "${DB_URL}" };\n`,
      "askdb.config.mjs": `import db from "./url.cjs";\nexport default { ${AI}, introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: db.url } } } };\n`,
    },
  ],
];

describe("a JavaScript config with jiti unavailable, as in an app's bundle (#833)", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function project(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "askdb-js-config-"));
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source, "utf8");
    return dir;
  }

  it.each(JS_CONFIGS)("loadAskDbConfigProjectionSync loads %s", (_label, files) => {
    const { projection } = loadAskDbConfigProjectionSync(project(files));
    expect(projection?.entries.ASKDB_INTROSPECT_POSTGRES_URL).toBe(DB_URL);
  });

  it.each(JS_CONFIGS)("loadAskDbConfigProjection loads %s", async (_label, files) => {
    const { projection } = await loadAskDbConfigProjection(project(files));
    expect(projection?.entries.ASKDB_INTROSPECT_POSTGRES_URL).toBe(DB_URL);
  });

  // config.test.ts loads TypeScript configs with the real jiti; here the mock shows it's still used.
  it("sends a TypeScript config to jiti", () => {
    expect(() => loadAskDbConfigProjectionSync(project({ "askdb.config.ts": `export default { ${BLOCKS} };\n` }))).toThrow(
      "i.createRequire is not a function",
    );
  });
});

// Fails when a package exports a name that its API reference pages never mention, so a new
// export can't ship undocumented (#713). It covers each package that has an API page:
// @askdb/core, @askdb/client, @askdb/config and @askdb/ai.
//
// It reads every entry point in the package's `exports` from source, with the TypeScript
// compiler, so `export *` and re-exports resolve without a build. A name counts as documented
// when one of the package's pages contains it as a whole word: exported names are camelCase,
// PascalCase or UPPER_CASE, so they don't occur as ordinary words. An internal export counts
// once a page lists it, as the core index does under "Internal exports".
import { createRequire } from "node:module";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceRoot = fileURLToPath(new URL("../src/content/docs/reference/", import.meta.url));

/** Each package and its reference pages: a file, or a directory whose pages all count. */
const PACKAGES = [
  { dir: "packages/core", pages: ["core-api"] },
  { dir: "packages/client", pages: ["client-api.mdx"] },
  { dir: "packages/config", pages: ["config-api.mdx"] },
  { dir: "packages/ai", pages: ["ai-api.mdx"] },
];

const ts = createRequire(join(repoRoot, "package.json"))("typescript");

/** The source file behind each entry point in `packageJson.exports`: `./dist/x.js` → `src/x.ts`. */
export function entryPoints(packageDir, packageJson) {
  const targets = Object.values(packageJson.exports ?? {}).map((target) =>
    typeof target === "string" ? target : (target.import ?? target.default ?? target.types),
  );
  return targets.map((target) => {
    const match = /^\.\/dist\/(.+)\.(?:d\.ts|js)$/.exec(target);
    if (!match) throw new Error(`${packageDir}: can't map the export target ${target} to a source file`);
    return join(packageDir, "src", `${match[1]}.ts`);
  });
}

/** Every name the module at `entry` exports, values and types, sorted. */
export function exportedNames(entry) {
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
  });
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`can't read ${entry}`);
  const module = program.getTypeChecker().getSymbolAtLocation(source);
  if (!module) return [];
  return program
    .getTypeChecker()
    .getExportsOfModule(module)
    .map((symbol) => symbol.getName())
    .sort();
}

/** The names in `names` that `pageText` doesn't contain as a whole word. */
export function undocumented(names, pageText) {
  return names.filter((name) => {
    const escaped = name.replace(/[$]/g, "\\$");
    return !new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(pageText);
  });
}

/** The text of every page a `pages` entry names. */
function readPages(pages) {
  return pages
    .flatMap((page) => {
      const path = join(referenceRoot, page);
      return statSync(path).isDirectory()
        ? readdirSync(path).filter((name) => /\.mdx?$/.test(name)).map((name) => join(path, name))
        : [path];
    })
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function main() {
  let failed = false;
  for (const { dir, pages } of PACKAGES) {
    const packageDir = join(repoRoot, dir);
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    const pageText = readPages(pages);
    for (const entry of entryPoints(packageDir, packageJson)) {
      const missing = undocumented(exportedNames(entry), pageText);
      if (missing.length > 0) {
        failed = true;
        console.error(`${packageJson.name}: ${entry.slice(repoRoot.length)} exports these, and ${pages.join(", ")} never names them:`);
        for (const name of missing) console.error(`  - ${name}`);
      }
    }
  }
  if (failed) {
    console.error("Document each one on its package's API page, or list it under the page's internal exports.");
    process.exit(1);
  }
  console.log("Every export of core, client, config and ai is named on its API page.");
}

// Compare real paths, so a run through a symbolic link (macOS's /tmp) still runs the check.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();

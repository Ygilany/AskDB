import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packagesDirectory = join(repositoryRoot, "packages");

type PackageManifest = {
  private?: boolean;
  exports?: Record<string, Record<string, string>>;
};

function publishedPackages() {
  return readdirSync(packagesDirectory)
    .map((name) => {
      const directory = join(packagesDirectory, name);
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) return undefined;
      return { directory, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest };
    })
    .filter((packageInfo): packageInfo is { directory: string; manifest: PackageManifest } => !!packageInfo)
    .filter(({ manifest }) => !manifest.private);
}

function sourcePathForTarget(directory: string, target: string) {
  return join(directory, "src", target.replace(/^\.\/dist\//, "").replace(/\.js$/, ".ts"));
}

function relativeStaticImports(source: string) {
  const specifiers: string[] = [];
  const matcher = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  for (const match of source.matchAll(matcher)) specifiers.push(match[1]!);
  return specifiers;
}

function exportedModuleGraph(entryPoint: string) {
  const reached = new Set<string>();
  const pending = [entryPoint];

  while (pending.length) {
    const path = pending.pop()!;
    if (reached.has(path)) continue;
    reached.add(path);

    const source = readFileSync(path, "utf8");
    for (const specifier of relativeStaticImports(source)) {
      const importedPath = resolve(dirname(path), specifier.replace(/\.js$/, ".ts"));
      if (existsSync(importedPath)) pending.push(importedPath);
    }
  }

  return [...reached];
}

// Parses the source and looks for `await` / `for await` outside every function body, so
// `(await x)`, `await(x)` and a multi-line initializer count, and an `await` inside an
// async function does not.
function hasTopLevelAwait(source: string) {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): boolean => {
    if (ts.isFunctionLike(node)) return false;
    if (ts.isAwaitExpression(node)) return true;
    if (ts.isForOfStatement(node) && node.awaitModifier) return true;
    return ts.forEachChild(node, (child) => visit(child) || undefined) ?? false;
  };
  return visit(file);
}

describe("published package requireability", () => {
  it("keeps default last in every export map", () => {
    for (const { directory, manifest } of publishedPackages()) {
      for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
        const keys = Object.keys(conditions);
        expect(keys, `${relative(repositoryRoot, directory)} ${subpath}`).toContain("default");
        expect(keys.at(-1), `${relative(repositoryRoot, directory)} ${subpath}`).toBe("default");
      }
    }
  });

  it("does not introduce top-level await in published sources", () => {
    // Top-level await in an exported graph makes ESM impossible to load synchronously through require().
    // Bin-only files such as packages/rag/src/bin.ts are intentionally excluded.
    const matches = publishedPackages().flatMap(({ directory, manifest }) =>
      Object.values(manifest.exports ?? {}).flatMap((conditions) => {
        if (!conditions.default) return [];
        const entryPoint = sourcePathForTarget(directory, conditions.default);
        return exportedModuleGraph(entryPoint).filter((path) => {
          const source = readFileSync(path, "utf8");
          return hasTopLevelAwait(source);
        });
      }),
    );

    expect(matches.map((path) => relative(repositoryRoot, path))).toEqual([]);
  });

  it.each([
    ["a bare await statement", "await Promise.resolve(1);"],
    ["an exported const initializer", "export const x = await Promise.resolve(1);"],
    ["a parenthesized await", "export const x = (await Promise.resolve(1));"],
    ["an await call form", "export default await(Promise.resolve(1));"],
    ["a let declaration", "let y = await Promise.resolve(1);"],
    ["a multi-line initializer", "export const z =\n  await Promise.resolve(1);"],
    ["a for await loop", "for await (const _ of []) {}"],
    ["an await in a top-level block", "if (true) {\n  await Promise.resolve(1);\n}"],
  ])("detects top-level await: %s", (_name, source) => {
    expect(hasTopLevelAwait(source)).toBe(true);
  });

  it.each([
    ["an async arrow on one line", "export const f = async () => { const x = await Promise.resolve(1); return x; };"],
    ["an async function declaration", "export async function g() {\n  return await Promise.resolve(1);\n}"],
    ["an async method", "export class C {\n  async m() {\n    for await (const _ of []) {}\n  }\n}"],
    ["await inside a string and a comment", 'const s = "await x"; // await y'],
  ])("does not flag await inside a function or text: %s", (_name, source) => {
    expect(hasTopLevelAwait(source)).toBe(false);
  });
});

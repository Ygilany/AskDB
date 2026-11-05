/**
 * Module layering (ADR 0010, "Module layering"): `@askdb/core` has no runtime import
 * cycles, and the mechanical renderer `sql/bind.ts` stays below tenant substitution and
 * the guardrails, which the checked binder `sql/rebind.ts` sits above. Type-only imports
 * and re-exports are erased at build time and don't count; a barrel's re-exports do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Each file's runtime imports of other files in `src`, re-exports (`export … from`) included. */
function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles(src)) {
    const targets: string[] = [];
    for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gms)) {
      const target = join(dirname(file), m[1]!).replace(/\.js$/, ".ts");
      targets.push(existsSync(target) ? target : target.replace(/\.ts$/, "/index.ts"));
    }
    graph.set(file, targets);
  }
  return graph;
}

describe("@askdb/core module layering", () => {
  const graph = importGraph();
  const name = (file: string) => relative(src, file);

  it("has no runtime import cycles", () => {
    const cycles: string[] = [];
    const state = new Map<string, "open" | "done">();
    const visit = (file: string, stack: string[]): void => {
      state.set(file, "open");
      stack.push(file);
      for (const next of graph.get(file) ?? []) {
        if (state.get(next) === "open") cycles.push([...stack.slice(stack.indexOf(next)), next].map(name).join(" -> "));
        else if (!state.has(next)) visit(next, stack);
      }
      stack.pop();
      state.set(file, "done");
    };
    for (const file of graph.keys()) if (!state.has(file)) visit(file, []);
    expect(cycles).toEqual([]);
  });

  it("keeps the mechanical renderer below tenant substitution and the guardrails", () => {
    const reachable = new Set<string>();
    const walk = (file: string): void => {
      for (const next of graph.get(file) ?? []) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        walk(next);
      }
    };
    walk(join(src, "sql/bind.ts"));
    const above = ["sql/tenant-placeholders.ts", "sql/guardrails.ts", "sql/guardrail-decide.ts", "sql/rebind.ts"];
    expect([...reachable].map(name).filter((file) => above.includes(file))).toEqual([]);
  });
});

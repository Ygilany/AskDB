import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as client from "./index.js";
import * as charts from "./charts/index.js";

const src = dirname(fileURLToPath(import.meta.url));

/** Every module specifier a file imports or re-exports, type-only ones included. */
function specifiers(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^(?:import|export)\b[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);
}

describe("@askdb/client public API", () => {
  it("exports resolveDialect, the dialect rule createAskDb runs (#886)", () => {
    expect(typeof client.resolveDialect).toBe("function");
  });

  it("doesn't re-export the experimental charts entry point from the root", () => {
    for (const name of ["planChart", "classifyResult", "validateChartSpec"]) expect(client).not.toHaveProperty(name);
  });
});

describe("@askdb/client/charts public API (experimental, #906)", () => {
  it("exports classifyResult, planChart and validateChartSpec, and nothing else at runtime", () => {
    expect(Object.keys(charts).sort()).toEqual(["classifyResult", "planChart", "validateChartSpec"]);
  });

  // Self-contained, so it can move to its own package: charts/ imports only its own files, `ai`
  // and `@askdb/core`, and nothing else in the client imports charts/.
  it("imports nothing from the rest of the client, and the client imports nothing from it", () => {
    const chartFiles = readdirSync(join(src, "charts")).filter((f) => f.endsWith(".ts"));
    for (const file of chartFiles) {
      for (const spec of specifiers(join(src, "charts", file))) {
        expect([spec, spec.startsWith("./") || spec === "ai" || spec === "ai/test" || spec === "@askdb/core" || spec.startsWith("node:") || spec === "vitest"]).toEqual([spec, true]);
      }
    }
    const clientFiles = readdirSync(src).filter((f) => f.endsWith(".ts") && f !== "public-api.test.ts");
    for (const file of clientFiles) {
      expect(specifiers(join(src, file)).filter((s) => s.includes("charts"))).toEqual([]);
    }
  });
});

/** How a "Get the code" snippet wires AskDB: through `@askdb/client` and the config, or straight to `@askdb/core`'s `ask()`. */
export type SnippetWiring = "client" | "core";

/**
 * The `npm install` line a "Get the code" snippet starts with.
 *
 * It names the required peers too: `@askdb/core` and `ai` for `@askdb/client`, and `ai` for
 * `@askdb/core` (ADR 0006, 2026-09 amendment), because Yarn doesn't install peers. Each package
 * appears once, so the gateway provider, whose SDK is `ai` itself, doesn't list `ai` twice.
 */
export function snippetInstallLine(wiring: SnippetWiring, sdkPackage: string): string {
  const base = wiring === "client" ? ["@askdb/client", "@askdb/core", "@askdb/config", "ai"] : ["@askdb/core", "ai"];
  return `npm install ${[...new Set([...base, sdkPackage])].join(" ")}`;
}

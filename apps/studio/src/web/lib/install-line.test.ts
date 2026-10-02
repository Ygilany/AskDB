import { describe, expect, it } from "vitest";
import { snippetInstallLine } from "./install-line";

// The Playground's "Get the code" snippets start with an install line users copy as-is.
// `@askdb/core` and `ai` are required peers of `@askdb/client`, and `ai` is a required peer of
// `@askdb/core` (ADR 0006, 2026-09 amendment). Yarn doesn't install peers, so the line has to
// name them. The gateway provider's SDK is `ai` itself, which must not be listed twice.
// One `@ai-sdk/*` package stands for every provider SDK; `ai` is the AI Gateway case.
const SDK_PACKAGES = ["@ai-sdk/openai", "ai"];

function packages(line: string): string[] {
  expect(line.startsWith("npm install ")).toBe(true);
  return line.slice("npm install ".length).split(" ");
}

describe("snippetInstallLine", () => {
  it.each(SDK_PACKAGES)("client wiring with %s installs the client, its required peers and the SDK, each once", (sdk) => {
    const pkgs = packages(snippetInstallLine("client", sdk));
    expect(new Set(pkgs)).toEqual(new Set(["@askdb/client", "@askdb/core", "@askdb/config", "ai", sdk]));
    expect(pkgs).toHaveLength(new Set(pkgs).size);
  });

  it.each(SDK_PACKAGES)("core wiring with %s installs core, ai and the SDK, each once", (sdk) => {
    const pkgs = packages(snippetInstallLine("core", sdk));
    expect(new Set(pkgs)).toEqual(new Set(["@askdb/core", "ai", sdk]));
    expect(pkgs).toHaveLength(new Set(pkgs).size);
  });
});

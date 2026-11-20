/**
 * Every hand-kept list that must follow `BUILTIN_AI_PROVIDERS`, outside the config ids
 * (`provider-config-drift.test.ts`) and Studio's lists (`apps/studio/src/setup-providers.test.ts`,
 * `apps/studio/src/provider-wiring.test.ts`): the optional peers of `@askdb/ai` and
 * `@askdb/client`, the dependencies of the batteries-included apps, and the provider table in
 * `@askdb/ai`'s README.
 *
 * It lives here, not in `packages/ai`, because `pnpm test:ai-floors` copies `packages/ai/src`
 * into a scratch project, where the other packages' files don't exist.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUILTIN_AI_PROVIDERS } from "@askdb/ai";
import { describe, expect, it } from "vitest";

type Manifest = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const repoFile = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
const manifest = (path: string) => JSON.parse(repoFile(path)) as Manifest;
const providerSdks = (names: Record<string, unknown> = {}) => Object.keys(names).filter((name) => name.startsWith("@ai-sdk/")).sort();

/** The SDK packages the built-in table says a host installs; a provider that ships inside `ai` has none. */
const PEER_PACKAGES = [...new Set(BUILTIN_AI_PROVIDERS.flatMap((row) => (row.peerPackage ? [row.peerPackage] : [])))].sort();

describe("built-in provider SDK packages", () => {
  it.each(["packages/ai/package.json", "packages/client/package.json"])("%s declares each one as an optional peer, and no other @ai-sdk package", (path) => {
    const { peerDependencies, peerDependenciesMeta = {} } = manifest(path);
    expect(providerSdks(peerDependencies)).toEqual(PEER_PACKAGES);
    expect(providerSdks(peerDependenciesMeta).filter((name) => peerDependenciesMeta[name]?.optional === true)).toEqual(PEER_PACKAGES);
  });

  it("@askdb/client's peer ranges equal @askdb/ai's, which it passes through", () => {
    const ai = manifest("packages/ai/package.json").peerDependencies ?? {};
    const client = manifest("packages/client/package.json").peerDependencies ?? {};
    for (const name of PEER_PACKAGES) expect(client[name], name).toBe(ai[name]);
  });

  it.each(["apps/cli/package.json", "apps/http-api/package.json", "apps/studio/package.json"])("%s depends on each one, so every built-in works after one install", (path) => {
    expect(providerSdks(manifest(path).dependencies)).toEqual(PEER_PACKAGES);
  });
});

describe("@askdb/ai README provider table", () => {
  const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const lines = repoFile("packages/ai/README.md").split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Provider (`ai.provider`)"));
  const end = lines.findIndex((line, i) => i > header && !line.startsWith("|"));
  const rows = lines.slice(header + 2, end).map(cells);

  it("has one row per built-in provider, in table order", () => {
    expect(header).toBeGreaterThan(-1);
    expect(rows.map(([provider]) => /^`([^`]+)`/.exec(provider ?? "")?.[1])).toEqual(BUILTIN_AI_PROVIDERS.map((row) => row.provider));
  });

  it.each(BUILTIN_AI_PROVIDERS.map((row) => ({ provider: row.provider, row })))("$provider: aliases, install, key variable and default model match", ({ row }) => {
    const [provider = "", install = "", keyVar = "", model = ""] = rows.find(([first]) => first?.startsWith(`\`${row.provider}\``)) ?? [];
    for (const alias of row.aliases) expect(provider).toContain(`\`${alias}\``);
    expect(install).toBe(row.peerPackage ? `\`${row.peerPackage}\`` : "nothing: ships with `ai`");
    expect(keyVar).toBe(`\`${row.env.apiKeyVars[0]}\``);
    expect(model.startsWith(`\`${row.env.defaultModel}\``)).toBe(true);
  });
});

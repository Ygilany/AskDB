/**
 * `pnpm lab:use registry`: publish the checkout to a local verdaccio the way the release
 * workflow publishes to npm, install the lab from it, and remove the registry.
 *
 * Protects: (1) what the lab installs is what `pnpm -r publish` (release.yml's publish
 * step) puts on a registry: `workspace:` dependencies rewritten to versions, `publishConfig`
 * fields applied, only `files` shipped; (2) the lab gets the tarballs just published even
 * at a version it already has, from npm or from an earlier publish (the checkout usually
 * carries the last release's version numbers), in the lockfile and on disk, and `--check`
 * fails when an installed package's files aren't the tarball the registry served; (3) the registry runs only for the run: no
 * container and no storage are left once `lab:use` exits, whether it succeeded or refused;
 * (4) the publish can't reach another registry: a credential in the user's npm config is
 * kept out of it, and a project `.npmrc` credential or scoped registry, or a package's
 * `publishConfig.registry`, that pnpm would act on stops the run before anything is published.
 * Catches: a publish step that doesn't rewrite `workspace:` ranges or apply `publishConfig`
 * (`npm publish` from each package dir, for one), a lockfile that keeps the old copy's
 * integrity so pnpm installs it from its store, an installed package dir pnpm kept from
 * the previous install because its path didn't change (npm's copy, in the lab), a
 * registry container or storage dir left behind, and a publish that a stray credential or
 * registry setting could send somewhere else (npm, in real life).
 * Not covered elsewhere: `pnpm smoke:install` and `lab:use .` install `pnpm pack` tarballs;
 * nothing else publishes, or installs from a registry it controls. `use.test.ts` covers
 * the lockfile side of `--check`, not installed files.
 * No production seam: `use.mjs` runs as shipped, with the real docker, verdaccio and pnpm,
 * from a scratch copy of the lab inside a scratch two-package AskDB checkout whose build
 * stamps each build with a fresh id, so two runs publish different tarballs at the same
 * version. Between the two runs the test swaps one installed file for other bytes (a new
 * file, not a write through pnpm's hard link into its store), standing in for a package
 * dir left from an earlier install. `LAB_REGISTRY_PORT` (documented, for a busy port) picks a free port, so a
 * registry another `lab:use` started isn't touched. The foreign registry in the refusal
 * cases is `registry.lab.invalid`, which never resolves: nothing is sent to npm.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const FOREIGN = "http://registry.lab.invalid/";
const VERSION = "0.0.1-lab.1";

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=lab", "-c", "user.email=lab@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

/**
 * A git repo shaped like an AskDB checkout (`@askdb/config`, and `@askdb/core` depending on
 * it through `workspace:^`), with a copy of the lab at `examples/consumer-lab`.
 * `corePublishConfig` and `npmrc` add a registry setting to the checkout.
 */
function scratchCheckout({ corePublishConfig = {}, npmrc }: { corePublishConfig?: Record<string, string>; npmrc?: string } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "lab-use-registry-"));
  scratch.push(repo);
  write(join(repo, "package.json"), json({ name: "scratch-askdb", private: true, scripts: { build: "node build.mjs" } }));
  write(join(repo, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  write(join(repo, ".gitignore"), "node_modules/\ndist/\n.lab/\n");
  write(
    join(repo, "build.mjs"),
    `import { mkdirSync, writeFileSync } from "node:fs";
const id = Math.random().toString(36).slice(2);
for (const pkg of ["config", "core"]) {
  mkdirSync(\`packages/\${pkg}/dist\`, { recursive: true });
  writeFileSync(\`packages/\${pkg}/dist/index.js\`, \`export const build = "\${id}";\\n\`);
}
`,
  );
  write(join(repo, "packages/config/package.json"), json({ name: "@askdb/config", version: VERSION, type: "module", main: "dist/index.js", files: ["dist"] }));
  write(
    join(repo, "packages/core/package.json"),
    json({
      name: "@askdb/core",
      version: VERSION,
      type: "module",
      main: "src/index.js",
      files: ["dist"],
      dependencies: { "@askdb/config": "workspace:^" },
      publishConfig: { main: "dist/index.js", ...corePublishConfig },
    }),
  );
  write(join(repo, "packages/core/src/index.js"), "export const build = 'source';\n");
  if (npmrc) write(join(repo, ".npmrc"), npmrc);

  const lab = join(repo, "examples", "consumer-lab");
  for (const file of ["src/use.mjs", "compose.yml", "verdaccio.yaml", ".gitignore"]) {
    mkdirSync(dirname(join(lab, file)), { recursive: true });
    cpSync(join(LAB, file), join(lab, file));
  }
  write(join(lab, "package.json"), json({ name: "scratch-lab", private: true, dependencies: { "@askdb/core": "0.0.0" } }));
  write(
    join(lab, "pnpm-workspace.yaml"),
    'minimumReleaseAgeExclude:\n  - askdb\n  - "@askdb/*"\noverrides:\n# lab:use overrides begin\n# lab:use target: none\n# lab:use overrides end\n',
  );
  // Installed, as release.yml installs before it publishes: pnpm resolves `workspace:` from the install.
  execFileSync("pnpm", ["install"], { cwd: repo, stdio: "ignore" });
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "scratch checkout");
  return { repo, lab };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Runs `use.mjs <args>` in the scratch lab, with a user npm config holding a credential for another registry. */
function useIn(lab: string, port: number, ...args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "lab-use-registry-npmrc-"));
  scratch.push(home);
  const userconfig = join(home, ".npmrc");
  writeFileSync(userconfig, `//registry.lab.invalid/:_authToken=lab-test-not-a-token\n`);
  const run = spawnSync("node", [join(lab, "src", "use.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, LAB_REGISTRY_PORT: String(port), npm_config_userconfig: userconfig, NPM_TOKEN: "lab-test-not-a-token" },
  });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

/** Proof the registry is gone: no container of its compose project, and its storage dir deleted. */
function expectRegistryGone(port: number, out: string) {
  const containers = execFileSync("docker", ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=askdb-lab-registry-${port}`], { encoding: "utf8" });
  expect(containers.trim(), "registry containers left").toBe("");
  const storage = /local registry at http:\/\/127\.0\.0\.1:\d+\/ \(storage (\S+)\)/.exec(out)?.[1];
  expect(storage, "lab:use names the registry's storage").toBeDefined();
  expect(existsSync(storage!), `${storage} is deleted`).toBe(false);
}

const installed = (lab: string, file: string) => readFileSync(join(lab, "node_modules", "@askdb", "core", file), "utf8");

describe("lab:use registry", () => {
  it("installs what pnpm publish put on a local registry, the new tarball at a version the lab had, then removes the registry", async () => {
    const { repo, lab } = scratchCheckout();
    const port = await freePort();

    const first = useIn(lab, port, "registry");
    expect(first.out).toContain("lab:use: all 2 @askdb packages resolve to the tarballs published to the local registry.");
    expect(first.status).toBe(0);
    expectRegistryGone(port, first.out);

    // Published, not packed by hand: the workspace range rewritten, publishConfig applied, only `files` shipped.
    const manifest = JSON.parse(installed(lab, "package.json"));
    expect(manifest.dependencies).toEqual({ "@askdb/config": `^${VERSION}` });
    expect(manifest.main).toBe("dist/index.js");
    expect(existsSync(join(lab, "node_modules", "@askdb", "core", "src"))).toBe(false);
    const firstBuild = readFileSync(join(repo, "packages/core/dist/index.js"), "utf8");
    expect(installed(lab, "dist/index.js")).toBe(firstBuild);
    expect(useIn(lab, port, "--check").status, "lab:use --check after the registry is gone").toBe(0);

    // A package dir that isn't what the registry served: --check names it.
    const stale = join(lab, "node_modules", ".pnpm", `@askdb+config@${VERSION}`, "node_modules", "@askdb", "config", "dist", "index.js");
    rmSync(stale);
    writeFileSync(stale, "export const build = 'from somewhere else';\n");
    const check = useIn(lab, port, "--check");
    expect(check.out).toMatch(/@askdb\/config\s+0\.0\.1-lab\.1\s+registry\s+<-- INSTALLED FILES AREN'T THE PUBLISHED TARBALL/);
    expect(check.status).toBe(1);

    // Republished at the same version with another build: the lab gets the new tarball.
    const second = useIn(lab, port, "registry");
    expect(second.out).toContain("lab:use: all 2 @askdb packages resolve to the tarballs published to the local registry.");
    expect(second.status).toBe(0);
    const secondBuild = readFileSync(join(repo, "packages/core/dist/index.js"), "utf8");
    expect(secondBuild).not.toBe(firstBuild);
    expect(installed(lab, "dist/index.js")).toBe(secondBuild);
    expect(readFileSync(stale, "utf8")).toBe(readFileSync(join(repo, "packages/config/dist/index.js"), "utf8"));
    expectRegistryGone(port, second.out);
  });

  it.each([
    { setting: "a project .npmrc credential for another registry", npmrc: `//registry.lab.invalid/:_authToken=lab-test-not-a-token\n`, names: "//registry.lab.invalid/:_authToken" },
    { setting: "a project .npmrc scoped registry for @askdb", npmrc: `@askdb:registry=${FOREIGN}\n`, names: "@askdb:registry" },
    { setting: "a package's publishConfig.registry", corePublishConfig: { registry: FOREIGN }, names: "@askdb/core's publishConfig.registry" },
  ])("refuses to publish with $setting, and removes the registry", async ({ npmrc, corePublishConfig, names }) => {
    const { lab } = scratchCheckout({ npmrc, corePublishConfig });
    const port = await freePort();

    const { status, out } = useIn(lab, port, "registry");
    expect(out).toContain("refusing to publish");
    expect(out).toContain(names);
    expect(out).not.toContain("Published package");
    expect(status).toBe(1);
    expectRegistryGone(port, out);
  });
});

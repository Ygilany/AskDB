/**
 * The host's own AI SDK pins against what the installed AskDB packages ask for.
 *
 * Protects: `reference/packages.mdx` ("Provider adapters"): the adapters declare `ai` as a
 * peer dependency, "your app should depend on `ai` directly when you want to pin the
 * version", and AskDB raises that floor only when it needs a newer version or a security
 * fix (ADR 0015). So a host pinned at the floor installs every AskDB package with no unmet
 * peer, and every AskDB package accepts the host's `ai`, so the package manager can share it.
 * Catches: a published floor raised above what the host pins, as a routine Dependabot
 * bump raised `ai` to `^7.0.113` in `askdb@1.0.0-beta.43` (#403). A raised peer range
 * fails `npm install` with ERESOLVE for a host on an older `ai`, and pnpm installs a
 * second AI SDK for AskDB. A runtime `ai` range (`@askdb/core`, the apps) raised alone
 * gives AskDB a second AI SDK with no peer warning, so every AskDB package must declare
 * the same `ai` range: the one the peer check holds the host's pin to.
 * Not covered elsewhere: the workspace's own tests resolve `ai` from its lockfile, at the
 * newest version, so they pass whatever the floor says, and `pnpm smoke:install` doesn't
 * pin `ai`, so npm installs whatever meets the range.
 * No production seam: pnpm's own `pnpm peers check --json` and `pnpm ls --json` over the
 * lab's install, and the installed packages' manifests. It checks the declared ranges, not
 * which `ai` versions the lockfile holds: those depend on what was installed before.
 *
 * The lab pins `ai` and `@ai-sdk/openai` at AskDB's floors by hand (README, "How `lab:use`
 * pins the target"). This scenario fails when a floor rises above those pins; it doesn't
 * notice a pin that rises above a floor.
 *
 * Needs an installed lab (`pnpm lab:use <target>`). Runs once, as `[postgres]`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAB_ROOT } from "../src/paths.js";

/** One unmet or missing peer in `pnpm peers check --json`. `parents` runs from the lab down to the package that declares the peer. */
interface PeerIssue {
  parents: { name: string; version: string }[];
  optional: boolean;
  wantedRange: string;
  foundVersion?: string;
}

/** `pnpm peers check --json`'s report for one importer. */
interface ImporterPeers {
  bad?: Record<string, PeerIssue[]>;
  missing?: Record<string, PeerIssue[]>;
}

/** The key pnpm gives the project's root importer, the lab itself. */
const LAB_IMPORTER = ".";

/** The lab's report from `pnpm peers check --json`. pnpm exits 1 when it finds an issue, with the report still on stdout. */
function labPeers(): ImporterPeers {
  let stdout: string;
  try {
    stdout = execFileSync("pnpm", ["peers", "check", "--json"], { cwd: LAB_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    stdout = String((error as { stdout?: unknown }).stdout ?? "");
    if (!stdout.trim()) throw error;
  }
  const report = (JSON.parse(stdout) as Record<string, ImporterPeers>)[LAB_IMPORTER];
  if (!report) throw new Error("pnpm peers check reported nothing for the lab; reinstall it with `pnpm lab:use <target>`");
  return report;
}

const isAskDb = (name: string) => name === "askdb" || name.startsWith("@askdb/");

/** "<package> wants <peer> <range>; the host has …" for each issue whose declaring package is AskDB's. */
function askDbIssues(issues: Record<string, PeerIssue[]> | undefined, hostHas: (issue: PeerIssue) => string): string[] {
  return Object.entries(issues ?? {}).flatMap(([peer, list]) =>
    list.flatMap((issue) => {
      const declarer = issue.parents.at(-1);
      return declarer && isAskDb(declarer.name) ? [`${declarer.name}@${declarer.version} wants ${peer} ${issue.wantedRange}; the host has ${hostHas(issue)}`] : [];
    }),
  );
}

/** A node of `pnpm ls --json`'s dependency tree. */
interface LsNode {
  path?: string;
  dependencies?: Record<string, LsNode>;
  devDependencies?: Record<string, LsNode>;
}

interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** The manifest of every AskDB package in the lab's current install, found through `pnpm ls --json`. */
function installedAskDbManifests(): Manifest[] {
  const out = execFileSync("pnpm", ["ls", "--json", "--depth", "Infinity"], { cwd: LAB_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const [lab] = JSON.parse(out) as LsNode[];
  const paths = new Set<string>();
  const walk = (deps: Record<string, LsNode> | undefined) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (isAskDb(name) && dep.path) paths.add(dep.path);
      walk(dep.dependencies);
    }
  };
  walk({ ...lab?.dependencies, ...lab?.devDependencies });
  if (!paths.size) throw new Error("pnpm ls found no AskDB package in the lab; reinstall it with `pnpm lab:use <target>`");
  return [...paths].map((path) => JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as Manifest);
}

describe("[postgres]", () => {
  it("host-peers: the host's own pins meet every peer range an installed AskDB package declares, and every AskDB package declares the same ai range", () => {
    const peers = labPeers();
    const unmet = [
      ...askDbIssues(peers.bad, (issue) => issue.foundVersion ?? "another version"),
      ...askDbIssues(
        Object.fromEntries(Object.entries(peers.missing ?? {}).map(([peer, list]) => [peer, list.filter((issue) => !issue.optional)])),
        () => "none",
      ),
    ];
    expect([...new Set(unmet)].sort()).toEqual([]);

    const declarersByRange: Record<string, string[]> = {};
    for (const manifest of installedAskDbManifests()) {
      for (const [field, ranges] of [["dependency", manifest.dependencies], ["peer", manifest.peerDependencies]] as const) {
        if (ranges?.ai) (declarersByRange[ranges.ai] ??= []).push(`${manifest.name}@${manifest.version} (${field})`);
      }
    }
    expect(Object.keys(declarersByRange), `every AskDB package declares one ai range: ${JSON.stringify(declarersByRange)}`).toHaveLength(1);
  });
});

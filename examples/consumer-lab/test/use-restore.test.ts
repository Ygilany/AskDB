/**
 * `pnpm lab:use --restore`, the lab half of `pnpm lab:reset`: the committed baseline is back
 * and installed from any state the lab can be left in, and nothing else is touched.
 *
 * Protects: after `--restore`, the lab's `package.json`, `pnpm-workspace.yaml` and
 * `pnpm-lock.yaml` are the committed ones, `.lab/` holds only the new target record (no
 * tarballs, cached schema artifacts or scratch projects), and the baseline is really
 * installed, starting from a half-finished `lab:use` (manifests rewritten, `node_modules`
 * partial, `.lab/` without a target) or from a lab whose `.lab/` and `node_modules` are
 * gone. Other files in and around the lab, tracked or not, stay as they were.
 * Catches: a restore that reinstalls over a partial `node_modules` (pnpm calls it "Already up
 * to date" and the lockfile check passes, so a missing driver goes unnoticed), one that
 * keeps `.lab/` leftovers such as schema artifacts cached from data a fixture reset replaced,
 * one that trips over a missing `.lab/`, and one that cleans more than it should (a
 * `git checkout .` or `git clean` over the lab).
 * Not covered elsewhere: no other test runs `--restore`; `use.test.ts` and
 * `use-npm-release.test.ts` cover `--check` and a failed switch.
 * No production seam: `use.mjs` runs as shipped, with the real git and pnpm, in a scratch
 * git repo holding a copy of the lab's committed manifests, so the real lab isn't touched.
 * The install needs the registry or a warm pnpm store, like every lab install.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const MANAGED = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=lab", "-c", "user.email=lab@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });

/** A git repo with a copy of the lab (committed manifests, this `use.mjs`) at `lab/`, plus files that must survive. */
function scratchRepo() {
  const repo = mkdtempSync(join(tmpdir(), "lab-use-restore-"));
  scratch.push(repo);
  const lab = join(repo, "lab");
  mkdirSync(join(lab, "src"), { recursive: true });
  // The committed manifests, not the working copy: `lab:use .` rewrites those before `lab:test`.
  for (const file of MANAGED) writeFileSync(join(lab, file), git(LAB, "show", `HEAD:./${file}`));
  for (const file of [".gitignore", "askdb.config.ts", "src/use.mjs"]) cpSync(join(LAB, file), join(lab, file));
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "scratch lab");
  // Must survive: a local edit to a tracked lab file, an untracked lab file, a file outside the lab.
  writeFileSync(join(lab, "askdb.config.ts"), "// a local edit\n", { flag: "a" });
  writeFileSync(join(lab, "notes.txt"), "mine\n");
  writeFileSync(join(repo, "outside.txt"), "mine\n");
  return { repo, lab };
}

/** What `pinTo` writes for a tarball target: `file:` specs in package.json and the overrides block. */
function rewriteManifests(lab: string) {
  const spec = "file:.lab/tarballs/askdb-1.0.0-beta.42.tgz";
  const pkg = JSON.parse(readFileSync(join(lab, "package.json"), "utf8"));
  pkg.dependencies.askdb = spec;
  writeFileSync(join(lab, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const ws = readFileSync(join(lab, "pnpm-workspace.yaml"), "utf8");
  writeFileSync(join(lab, "pnpm-workspace.yaml"), ws.replace(/# lab:use target: .*\noverrides:\n/, `# lab:use target: checkout /elsewhere\noverrides:\n  "askdb": "${spec}"\n`));
  // An install stopped part-way through rewriting the lockfile.
  const lock = readFileSync(join(lab, "pnpm-lock.yaml"), "utf8");
  writeFileSync(join(lab, "pnpm-lock.yaml"), lock.slice(0, lock.length / 2));
}

const BROKEN_STATES = [
  {
    state: "a half-finished lab:use (manifests rewritten, node_modules partial, .lab/ without a target)",
    breakLab(lab: string) {
      // A complete install of the baseline, then part of it gone, as an interrupted switch leaves it.
      execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: lab, stdio: "ignore" });
      rmSync(join(lab, "node_modules", "pg"), { recursive: true });
      rewriteManifests(lab);
      for (const dir of ["tarballs", "artifacts/checkout-x/postgres", "projects/run-1"]) mkdirSync(join(lab, ".lab", dir), { recursive: true });
      writeFileSync(join(lab, ".lab", "tarballs", "askdb-1.0.0-beta.42.tgz"), "");
      writeFileSync(join(lab, ".lab", "artifacts", "checkout-x", "postgres", "schema.json"), "{}");
      writeFileSync(join(lab, ".lab", "projects", "run-1", "askdb.config.ts"), "");
    },
  },
  {
    state: "a missing .lab/ (manifests rewritten, no node_modules)",
    breakLab: rewriteManifests,
  },
];

it.each(BROKEN_STATES)("restores and installs the committed baseline from $state, touching nothing else", ({ breakLab }) => {
  const { repo, lab } = scratchRepo();
  breakLab(lab);

  const run = spawnSync("node", [join(lab, "src", "use.mjs"), "--restore"], { encoding: "utf8" });
  const out = `${run.stdout}\n${run.stderr}`;
  expect(out).toContain("restored the committed baseline (npm:latest): published packages, not this checkout.");
  expect(out).toContain("`pnpm lab:use .` installs this checkout.");
  expect(run.status).toBe(0);

  // The managed manifests are as committed; the local edit and both untracked files are still there.
  expect(git(repo, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M lab/askdb.config.ts", "?? lab/notes.txt", "?? outside.txt"]);
  expect(readFileSync(join(repo, "outside.txt"), "utf8")).toBe("mine\n");

  expect(readdirSync(join(lab, ".lab"))).toEqual(["target.json"]);
  expect(JSON.parse(readFileSync(join(lab, ".lab", "target.json"), "utf8")).label).toBe("committed baseline (npm:latest)");

  // Installed for real: the driver the partial tree lacked, and a working CLI.
  expect(existsSync(join(lab, "node_modules", "pg", "package.json")), "node_modules/pg is installed").toBe(true);
  expect(spawnSync(join(lab, "node_modules", ".bin", "askdb"), ["--help"], { encoding: "utf8" }).status, "askdb --help exit code").toBe(0);
});

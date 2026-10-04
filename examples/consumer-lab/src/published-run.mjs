#!/usr/bin/env node
/**
 * The report and the verdict of a lab run against published AskDB: the `Consumer lab
 * (published)` workflow (`.github/workflows/consumer-lab-published.yml`, #255) runs it after
 * `pnpm lab:use npm:<…>` and `pnpm lab:matrix`. Each command prints Markdown, and appends it
 * to `$GITHUB_STEP_SUMMARY` when that is set.
 *
 *   node examples/consumer-lab/src/published-run.mjs baseline
 *   node examples/consumer-lab/src/published-run.mjs drift <lockfile-before>
 *   node examples/consumer-lab/src/published-run.mjs verdict [--after-release]
 *
 * - `baseline`: whether `lab:use` changed the committed `npm:latest` baseline (the lab's
 *   `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`), and which AskDB pins moved.
 *   Run it right after `pnpm lab:use npm:latest`. Exits 0 either way: a stale baseline is
 *   refreshed by hand (`.agents/skills/consumer-lab/baseline-refresh.md`).
 * - `drift <lockfile-before>`: every package whose resolved versions differ between
 *   `<lockfile-before>` and the lab's `pnpm-lock.yaml`, after a fresh install replaced it.
 * - `verdict`: exits 0 when every failure of the run is expected, 1 otherwise. It reads
 *   `.lab/matrix.json` (the matrix reporter's), `.lab/vitest-results.json` (vitest's `json`
 *   reporter, which also sees the failing tests outside the matrix) and `.lab/target.json`
 *   (`lab:use`'s). A failure is expected when `known-release-failures.json` lists its cell
 *   for the installed `askdb` version: a release that shipped with a bug the lab already
 *   catches, fixed on `main` but not released. A failing test outside the matrix, an
 *   unhandled error, or a run that left no results is never expected. `--after-release`
 *   (the lab checked out at the commit just published) also lists every capability `n/a`
 *   cell: CI ran the lab on that commit with `lab:use .`, where a missing capability fails,
 *   so the release should have every capability. It fails on them unless a changeset was
 *   still pending at that commit, whose change the release may not include yet.
 *   Exits 2 when an input is missing or malformed.
 *
 * Dependency-free, like `use.mjs`.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(LAB, "../..");
const STATE = join(LAB, ".lab");
const MANAGED = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
const KNOWN = "known-release-failures.json";
const USAGE = "usage: node examples/consumer-lab/src/published-run.mjs baseline | drift <lockfile-before> | verdict [--after-release]";
/** The matrix reporter's test-name rule: `[<dialect>] <scenario-id>…`, describe blocks joined by " " or " > ". */
const NAME = /^\[([a-z]+)\][\s>]+([a-z0-9][\w-]*)/i;

function refuse(message) {
  console.error(`published-run: ${message}`);
  process.exit(2);
}

function readJson(file, what) {
  if (!existsSync(file)) refuse(`${file} doesn't exist: ${what}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return refuse(`${file} isn't JSON: ${error.message}`);
  }
}

function report(lines) {
  const text = `${lines.join("\n")}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

/** The `"name": "version"` pins in a pnpm-workspace.yaml's lab:use block, and its target label. */
function labUseBlock(text) {
  const block = text.slice(text.indexOf("# lab:use overrides begin"), text.indexOf("# lab:use overrides end"));
  const label = /^# lab:use target: (.+)$/m.exec(block)?.[1];
  return { label, pins: new Map([...block.matchAll(/^ {2}"([^"]+)": "([^"]+)"$/gm)].map(([, name, version]) => [name, version])) };
}

function baseline() {
  const git = (...args) => execFileSync("git", ["-C", LAB, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const changed = MANAGED.filter((file) => git("status", "--porcelain", "--", file).trim());
  const committed = labUseBlock(git("show", "HEAD:./pnpm-workspace.yaml"));
  const now = labUseBlock(readFileSync(join(LAB, "pnpm-workspace.yaml"), "utf8"));
  const lines = ["### Committed baseline", ""];
  if (!changed.length) {
    lines.push(`Current: \`pnpm lab:use ${now.label}\` changed none of the lab's ${MANAGED.map((f) => `\`${f}\``).join(", ")}, so the committed baseline is what it installs (askdb@${now.pins.get("askdb")}).`);
    return report(lines);
  }
  lines.push(
    `**Stale:** \`pnpm lab:use ${now.label}\` changed ${changed.map((f) => `\`${f}\``).join(", ")}. Refresh the baseline in its own PR: \`.agents/skills/consumer-lab/baseline-refresh.md\`.`,
    "",
  );
  const names = [...new Set([...committed.pins.keys(), ...now.pins.keys()])].sort();
  const moved = names.filter((name) => committed.pins.get(name) !== now.pins.get(name));
  if (moved.length) {
    lines.push("| package | committed | now |", "| --- | --- | --- |", ...moved.map((n) => `| ${n} | ${committed.pins.get(n) ?? "-"} | ${now.pins.get(n) ?? "-"} |`));
  } else {
    lines.push("No AskDB pin moved: the install resolved differently from the committed lockfile. Find out why before refreshing.");
  }
  report(lines);
}

/** name → sorted versions, from a pnpm v9 lockfile's `packages:` section (`name@version:` keys). */
function lockedVersions(file) {
  const lock = readFileSync(file, "utf8");
  const start = lock.indexOf("\npackages:\n");
  const end = lock.indexOf("\nsnapshots:\n", start);
  const versions = new Map();
  if (start >= 0) {
    for (const [, name, version] of lock.slice(start, end < 0 ? undefined : end).matchAll(/^ {2}'?((?:@[^/@\s']+\/)?[^@\s']+)@([^'\s]+?)'?:$/gm)) {
      versions.set(name, [...(versions.get(name) ?? []), version].sort());
    }
  }
  // An empty map would report "nothing drifted": refuse a lockfile this can't read instead.
  if (!versions.size) refuse(`${file} has no packages this script can read (a pnpm lockfile format it doesn't know?)`);
  return versions;
}

function drift(beforeFile) {
  if (!beforeFile) refuse(USAGE);
  if (!existsSync(beforeFile)) refuse(`${beforeFile} doesn't exist`);
  const before = lockedVersions(beforeFile);
  const after = lockedVersions(join(LAB, "pnpm-lock.yaml"));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const show = (v) => v?.join(", ") ?? "-";
  const moved = names.filter((name) => show(before.get(name)) !== show(after.get(name)));
  const lines = ["### Fresh install", "", `Every dependency resolved anew, without the lab's lockfile: ${after.size} packages.`];
  if (moved.length) {
    lines.push(`${moved.length} resolved differently from \`lab:use\`'s lockfile:`, "", "| package | lockfile | fresh |", "| --- | --- | --- |");
    lines.push(...moved.map((n) => `| ${n} | ${show(before.get(n))} | ${show(after.get(n))} |`));
  } else {
    lines.push("Each resolved to the version in `lab:use`'s lockfile.");
  }
  lines.push("", "The fresh lockfile is in the `consumer-lab-published` artifact.");
  report(lines);
}

function verdict(afterRelease) {
  const matrix = readJson(join(STATE, "matrix.json"), "run `pnpm lab:matrix` first");
  if (!Array.isArray(matrix.rows) || !Array.isArray(matrix.dialects)) refuse(".lab/matrix.json isn't a lab matrix (no rows or dialects)");
  const results = readJson(join(STATE, "vitest-results.json"), "run `pnpm lab:matrix --reporter=json --outputFile.json=.lab/vitest-results.json`");
  if (!Array.isArray(results.testResults)) refuse(".lab/vitest-results.json isn't a vitest json report");
  const target = readJson(join(STATE, "target.json"), "the lab isn't installed");
  const askdb = target.packages?.find((p) => p.name === "askdb")?.version;
  if (!askdb) refuse(`.lab/target.json (${target.label}) has no askdb package`);

  const knownFile = join(LAB, KNOWN);
  const expected = new Map(Object.entries(readJson(knownFile, "")[`askdb@${askdb}`] ?? {}));
  const unexpected = [];
  for (const [cell, why] of expected) {
    // As with `it.fails`, an expectation must name the issue that tracks it.
    if (!/#\d+/.test(why)) unexpected.push(`${KNOWN}: \`${cell}\` names no issue (\`#N\`) for askdb@${askdb}`);
  }

  const cells = matrix.rows.flatMap((row) => matrix.dialects.flatMap((d) => (row.cells?.[d] ? [{ name: `${row.scenario} [${d}]`, cell: row.cells[d] }] : [])));
  const failed = cells.filter((c) => c.cell.status === "fail");
  const failedExpected = failed.filter((c) => expected.has(c.name));
  for (const c of failed) if (!expected.has(c.name)) unexpected.push(`FAIL cell \`${c.name}\``);
  // vitest's own report holds the failures the matrix can't place: tests outside it, and files that failed to run.
  for (const file of results.testResults) {
    const path = relative(LAB, file.name);
    if (file.message) unexpected.push(`\`${path}\` failed outside its tests: ${file.message.split("\n")[0]}`);
    for (const test of file.assertionResults ?? []) {
      if (test.status !== "failed") continue;
      // A failed test in a FAIL cell is that cell's: expected with it, or reported above.
      const match = NAME.exec(test.fullName);
      const cell = match && `${match[2]} [${match[1].toLowerCase()}]`;
      if (!cell || !failed.some((c) => c.name === cell)) unexpected.push(`failed test \`${test.fullName}\` (${path})`);
    }
  }
  for (const error of matrix.unhandledErrors ?? []) unexpected.push(`unhandled error: ${error.split("\n")[0]}`);
  if (results.success === false && !unexpected.length && !failedExpected.length) unexpected.push("vitest reported a failed run with no failing test");

  const lines = ["### Verdict", "", `Installed: askdb@${askdb} (\`${target.label}\`).`, ""];
  if (failedExpected.length) {
    lines.push(`**${failedExpected.length} expected FAIL cell(s)**, listed for askdb@${askdb} in \`examples/consumer-lab/${KNOWN}\`: fixed on \`main\`, not released yet.`, "");
    lines.push("| cell | why |", "| --- | --- |", ...failedExpected.map((c) => `| ${c.name} | ${expected.get(c.name)} |`), "");
  }
  const passing = [...expected.keys()].filter((name) => !failed.some((c) => c.name === name));
  if (passing.length) {
    lines.push(`Listed as expected for askdb@${askdb} but not failing: ${passing.map((n) => `\`${n}\``).join(", ")}. Remove them from \`${KNOWN}\` if they keep passing.`, "");
  }

  let flips = [];
  if (afterRelease) {
    flips = cells.filter((c) => c.cell.status === "na");
    const dir = join(REPO, ".changeset");
    const pending = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort() : [];
    lines.push("### Capabilities after this release", "");
    if (!flips.length) {
      lines.push("No capability `n/a` cell: the release has every capability the lab checks.", "");
    } else {
      lines.push(
        `${flips.length} capability \`n/a\` cell(s). CI passed the lab on this commit with \`lab:use .\`, where a missing capability fails, so each should have flipped with this release:`,
        "",
        ...flips.map((c) => `- \`${c.name}\`: ${c.cell.text}`),
        "",
      );
      if (pending.length) {
        lines.push(
          `${pending.length} changeset(s) were still pending at this commit, so the release may not include their changes yet: ${pending.map((f) => `\`.changeset/${f}\``).join(", ")}. Check each capability's change with \`.agents/skills/consumer-lab/baseline-refresh.md\` step 3.`,
          "",
        );
        flips = [];
      } else {
        lines.push("No changeset was pending at this commit, so the release lacks a change it should have shipped, or a detector misreads it: a finding (`.agents/skills/consumer-lab/baseline-refresh.md` step 3).", "");
      }
    }
  }

  if (unexpected.length || flips.length) {
    lines.push(`**Failed:** ${unexpected.length + flips.length} problem(s) not expected for askdb@${askdb}.`, "", ...unexpected.map((u) => `- ${u}`), ...flips.map((c) => `- capability \`n/a\` after the release: \`${c.name}\``));
    report(lines);
    process.exit(1);
  }
  lines.push(failedExpected.length ? "**Passed**, with the expected failures above." : "**Passed.**");
  report(lines);
}

const [command, ...args] = process.argv.slice(2);
if (command === "baseline" && !args.length) baseline();
else if (command === "drift" && args.length === 1) drift(resolve(args[0]));
else if (command === "verdict" && (!args.length || (args.length === 1 && args[0] === "--after-release"))) verdict(args.length === 1);
else refuse(USAGE);

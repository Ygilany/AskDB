#!/usr/bin/env node
// @ts-check
// Checks verify-askdb's feature map (.agents/skills/verify-askdb/features/) against the replays in
// e2e/, both ways. `pnpm e2e` runs it first; by hand: `node e2e/harness/check-feature-map.mjs`.
//
// Prints one line per problem, `<file>:<line>: <what is wrong>`, and exits 1 on any. The rules:
//   - a feature file has its four H2 sections in the order the map's README gives
//   - every sub-feature line is `- \`<id>\` ... Scripted: \`<path>\`[ and \`<path>\`].` or `... Agent-driven.`
//   - a sub-feature ID is used once in the whole map
//   - every `Scripted:` path exists and has a test named with that ID
//   - every replay test is named with sub-feature IDs, each scripted to that file by the map
//   - the README links every feature file
// A test's name starts with its IDs, joined by `,` or `and`, then `:` and what it shows
// (`overview-cards and overview-pending: counts, then a row opens its table`). A test that pins a
// known bug is named with the sub-feature the bug belongs to, and says so after the colon.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECTIONS = ["Sub-features", "How to get to it (user POV)", "Driving it with control-askdb", "Gotchas"];
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** @typedef {{ file: string, line: number, message: string }} Problem */
/** @typedef {{ id: string, file: string, line: number, scripted: string[] }} SubFeature */

/**
 * The sub-features of one feature file, and what is wrong with its layout.
 * @param {string} file path as it should print
 * @param {string} text
 * @returns {{ subFeatures: SubFeature[], problems: Problem[] }}
 */
export function parseFeatureFile(file, text) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {SubFeature[]} */
  const subFeatures = [];
  const lines = text.split("\n");
  const headings = lines.flatMap((line, i) => (line.startsWith("## ") ? [{ title: line.slice(3).trim(), line: i + 1 }] : []));
  if (headings.map((h) => h.title).join("|") !== SECTIONS.join("|")) {
    problems.push({ file, line: headings[0]?.line ?? 1, message: `the H2 sections must be, in order: ${SECTIONS.join(", ")}` });
  }
  const start = headings.find((h) => h.title === SECTIONS[0])?.line;
  if (start === undefined) return { subFeatures, problems };
  const end = headings.find((h) => h.line > start)?.line ?? lines.length + 1;
  for (let n = start + 1; n < end; n += 1) {
    const line = lines[n - 1] ?? "";
    if (!line.startsWith("- ")) continue;
    const id = /^- `([^`]+)`/.exec(line)?.[1];
    if (!id || !ID.test(id)) {
      problems.push({ file, line: n, message: "a sub-feature line starts with its ID in backticks: - `feature-behavior` ..." });
      continue;
    }
    const ending = /(?:Scripted: ((?:`[^`]+`)(?: and `[^`]+`)*)|Agent-driven)\.$/.exec(line.trimEnd());
    if (!ending) {
      problems.push({ file, line: n, message: `\`${id}\` must end "Scripted: \`<replay path>\`." (paths joined by "and") or "Agent-driven."` });
      continue;
    }
    subFeatures.push({ id, file, line: n, scripted: ending[1] ? [...ending[1].matchAll(/`([^`]+)`/g)].map((m) => /** @type {string} */ (m[1])) : [] });
  }
  if (!subFeatures.length && !problems.length) problems.push({ file, line: start, message: "the Sub-features section lists no sub-feature" });
  return { subFeatures, problems };
}

/**
 * The tests in one replay file: each title, and the sub-feature IDs it starts with.
 * @param {string} text
 * @returns {{ title: string, line: number, ids: string[] }[]}
 */
export function parseReplayTests(text) {
  const tests = [];
  const call = /^\s*(?:test|it)(?:\.(?:only|skip|fixme|fails|concurrent|sequential))*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const title = call.exec(lines[i] ?? "")?.[2];
    if (title === undefined) continue;
    const head = title.includes(":") ? title.slice(0, title.indexOf(":")) : title;
    const ids = head
      .split(/,| and /)
      .map((part) => part.trim().replace(/\s*\([^)]*\)$/, ""))
      .filter(Boolean);
    tests.push({ title, line: i + 1, ids: ids.every((id) => ID.test(id)) ? ids : [] });
  }
  return tests;
}

/**
 * @param {string} dir
 * @returns {string[]} replay files under dir, as absolute paths
 */
function replayFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "harness" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return replayFiles(path);
    return /\.(test|spec)\.ts$/.test(entry.name) ? [path] : [];
  });
}

/**
 * @param {{ repoRoot: string, mapDir?: string, replayDir?: string }} options
 * @returns {Problem[]}
 */
export function checkFeatureMap({ repoRoot, mapDir = ".agents/skills/verify-askdb/features", replayDir = "e2e" }) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {SubFeature[]} */
  const subFeatures = [];
  const readme = join(mapDir, "README.md");
  const readmeText = existsSync(join(repoRoot, readme)) ? readFileSync(join(repoRoot, readme), "utf8") : "";
  const featureFiles = readdirSync(join(repoRoot, mapDir)).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
  for (const name of featureFiles) {
    const file = join(mapDir, name);
    const parsed = parseFeatureFile(file, readFileSync(join(repoRoot, file), "utf8"));
    problems.push(...parsed.problems);
    subFeatures.push(...parsed.subFeatures);
    if (!readmeText.includes(`(./${name})`)) problems.push({ file: readme, line: 1, message: `no link to ./${name} under Features` });
  }

  /** @type {Map<string, SubFeature>} */
  const byId = new Map();
  for (const sub of subFeatures) {
    const first = byId.get(sub.id);
    if (first) problems.push({ file: sub.file, line: sub.line, message: `\`${sub.id}\` is already a sub-feature at ${first.file}:${first.line}` });
    else byId.set(sub.id, sub);
  }

  /** @type {Map<string, ReturnType<typeof parseReplayTests>>} */
  const replays = new Map();
  for (const path of replayFiles(join(repoRoot, replayDir))) replays.set(relative(repoRoot, path).split("\\").join("/"), parseReplayTests(readFileSync(path, "utf8")));

  for (const sub of byId.values()) {
    for (const path of sub.scripted) {
      const tests = replays.get(path);
      if (!tests) problems.push({ file: sub.file, line: sub.line, message: `\`${sub.id}\` is scripted to ${path}, which is not a replay file under ${replayDir}/` });
      else if (!tests.some((t) => t.ids.includes(sub.id))) problems.push({ file: sub.file, line: sub.line, message: `\`${sub.id}\` is scripted to ${path}, which has no test named with it` });
    }
  }
  for (const [path, tests] of replays) {
    if (!tests.length) problems.push({ file: path, line: 1, message: "no test found: write each as test(\"<id>: ...\") or it(\"<id>: ...\") with the name on the same line" });
    for (const t of tests) {
      if (!t.ids.length) {
        problems.push({ file: path, line: t.line, message: `"${t.title}" must start with the sub-feature IDs it replays, then ":"` });
        continue;
      }
      for (const id of t.ids) {
        const sub = byId.get(id);
        if (!sub) problems.push({ file: path, line: t.line, message: `\`${id}\` is not a sub-feature in the map; name a pinned-bug test with the sub-feature it belongs to` });
        else if (!sub.scripted.includes(path)) problems.push({ file: path, line: t.line, message: `\`${id}\` has a test here, but ${sub.file}:${sub.line} does not say "Scripted: \`${path}\`"` });
      }
    }
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const problems = checkFeatureMap({ repoRoot });
  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.message}`);
  if (problems.length) {
    console.error(`check-feature-map: ${problems.length} problem(s). The contract is in .agents/skills/verify-askdb/features/README.md.`);
    process.exit(1);
  }
  console.log("check-feature-map: the feature map and the replays agree.");
}

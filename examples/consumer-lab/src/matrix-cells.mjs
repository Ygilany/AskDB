#!/usr/bin/env node
/**
 * Lists a matrix's cells that aren't `pass`, one per line, grouped by their value, so a
 * reader can account for every one of them (the consumer-lab skill's triage and baseline
 * refresh do).
 *
 *   node examples/consumer-lab/src/matrix-cells.mjs [--status fail,known,na,miss] [<matrix.json>]
 *
 * `<matrix.json>` defaults to the lab's `.lab/matrix.json`, the one `pnpm lab:matrix` last
 * wrote. Pass another path to read CI's `consumer-lab-matrix` artifact. `--status` keeps some
 * of `fail`, `known`, `na` and `miss` (default: all four). Groups: every `FAIL` cell with the
 * first line of each failure's reason, then one group per issue (`known (#N)`), per capability
 * (`n/a (capability: …)`) and per live-model miss (`miss (raw: wrong rows)`, only in a
 * `LAB_LIVE_MODEL=1` run). A cell that names several, such as
 * `n/a (capability: a, capability: b)`, is listed under each. Exits 2 when the file is
 * missing or isn't a matrix.
 *
 * Dependency-free, like `use.mjs`: it reads a JSON file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The `--status` values, the reporter's cell statuses, and how the matrix prints each. */
const LABELS = { fail: "FAIL", known: "known", na: "n/a", miss: "miss" };
const STATUSES = Object.keys(LABELS);
const USAGE = "usage: node examples/consumer-lab/src/matrix-cells.mjs [--status fail,known,na,miss] [<matrix.json>]";

function refuse(message) {
  console.error(`matrix-cells: ${message}`);
  process.exit(2);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({ options: { status: { type: "string", default: STATUSES.join(",") } }, allowPositionals: true });
  } catch (error) {
    return refuse(`${error.message}\n${USAGE}`);
  }
})();
const wanted = values.status.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = wanted.filter((s) => !STATUSES.includes(s));
if (unknown.length || !wanted.length || positionals.length > 1) refuse(USAGE);

const file = resolve(positionals[0] ?? join(LAB, ".lab", "matrix.json"));
if (!existsSync(file)) refuse(`${file} doesn't exist; run \`pnpm lab:matrix\` first, or pass the path of a matrix.json`);
let matrix;
try {
  matrix = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  refuse(`${file} isn't JSON: ${error.message}`);
}
// A file of another shape would list nothing, which reads as "no findings": refuse it instead.
if (!Array.isArray(matrix?.rows) || !Array.isArray(matrix?.dialects)) refuse(`${file} isn't a lab matrix (no rows or dialects)`);

/**
 * The groups a cell belongs to: `FAIL`, or one per issue or capability its text names.
 * `matrix.json` keeps only the text, where the reporter joins them with ", " inside one pair
 * of parentheses (misses with "; ", since a miss reason may hold a comma);
 * `test/matrix-cells.test.ts` runs the real reporter, so it fails if that changes.
 */
function groupsOf(cell) {
  if (cell.status === "fail") return [LABELS.fail];
  if (cell.status === "miss") return cell.text.replace(/^miss \((.*)\)$/, "$1").split("; ").map((part) => `miss (${part})`);
  const match = /^(known|n\/a) \((.*)\)$/.exec(cell.text);
  return match ? match[2].split(", ").map((part) => `${match[1]} (${part})`) : [cell.text];
}

/** `status` → group (`FAIL`, `known (#N)`, `n/a (capability: …)`, `miss (…)`) → cells. */
const groups = new Map(STATUSES.map((s) => [s, new Map()]));
const listed = new Set();
for (const row of matrix.rows) {
  for (const dialect of matrix.dialects) {
    const cell = row.cells?.[dialect];
    if (!cell || !wanted.includes(cell.status)) continue;
    const name = `${row.scenario} [${dialect}]`;
    listed.add(name);
    for (const group of groupsOf(cell)) {
      const byGroup = groups.get(cell.status);
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push({ name, failures: cell.failures ?? [] });
    }
  }
}

const out = [`matrix: ${file}`, `target: ${matrix.target ?? "(not recorded)"}`, `generated: ${matrix.generatedAt ?? "(not recorded)"}`];
for (const status of wanted) {
  const byGroup = groups.get(status);
  if (!byGroup.size) {
    out.push("", `${LABELS[status]}: none`);
    continue;
  }
  for (const [group, cells] of [...byGroup].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    out.push("", `${group}: ${cells.length} cell(s)`);
    for (const cell of cells) {
      out.push(`  ${cell.name}`);
      for (const f of cell.failures) out.push(`    - ${f.test}: ${f.reason.split("\n")[0]}`);
    }
  }
}
out.push("", `${listed.size} cell(s) listed.`);
if (matrix.unhandledErrors?.length) out.push(`${matrix.unhandledErrors.length} unhandled error(s) outside any test: see matrix.json.`);
console.log(out.join("\n"));

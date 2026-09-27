/**
 * Vitest reporter for `pnpm lab:matrix`: a `scenario × dialect` table built from test
 * results, printed and written to `.lab/matrix.json` (and appended to
 * `$GITHUB_STEP_SUMMARY` when set).
 *
 * A test joins the matrix through its full name (describe blocks + test name):
 * `[<dialect>] <scenario-id>…`, for example `describe("[mysql]")` around
 * `it("introspect-golden: …")`. Several tests may share a cell. A cell is:
 *
 * - `FAIL` if any of its tests failed (an `it.fails` test whose bug is fixed fails too);
 * - `known (#N)` if its tests are `it.fails` cases naming issue `#N` that failed as expected;
 * - `pass` if its tests passed;
 * - `n/a (reason)` if its tests were skipped with `ctx.skip("reason")`;
 * - `-` if no test ran for it (none exists, or a filter excluded it).
 *
 * Any `FAIL` cell fails the run (exit code 1), even one vitest counts as passing: an
 * `it.fails` test that names no issue, or a skip that isn't a capability gate. CI's
 * consumer-lab job relies on this; `pass`, `n/a` and `known` cells don't fail it.
 *
 * After the test rows come annotation rows, marked `*`: facts the golden schema holds but
 * the schema artifact can't express, so no test can compare them. They are a static list, not test
 * results; see {@link ARTIFACT_LIMITS}.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_STATE } from "./paths.js";
import type { Reporter, SerializedError, TestCase, TestModule } from "vitest/node";
import { DIALECTS } from "./fixture.js";

const NAME = /^\[([a-z]+)\][\s>]+([a-z0-9][\w-]*)/i;
const ISSUE = /\(#(\d+)\)/g;

/**
 * The golden-schema facts the schema artifact can't express, from the "Not comparable" rule in
 * `fixtures/multi-engine/dataset/NORMALIZATION.md` (survey note 6 in
 * `docs/specs/consumer-lab.md`). Rendered as `n/a (not in the schema artifact)` on every dialect.
 */
const ARTIFACT_LIMITS = ["unique-constraints", "view-marker"] as const;
const ARTIFACT_LIMIT_TEXT = "n/a (not in the schema artifact)";

type Status = "pass" | "fail" | "known" | "na";

interface Cell {
  status: Status;
  text: string;
  tests: string[];
}

interface Outcome {
  status: Status | "not-run";
  detail?: string;
}

function outcomeOf(test: TestCase): Outcome {
  const result = test.result();
  if (result.state === "failed") return { status: "fail" };
  if (result.state === "passed") {
    if (!test.options.fails) return { status: "pass" };
    const issues = [...test.name.matchAll(ISSUE)].map((m) => `#${m[1]}`);
    // An expected failure that names no issue isn't tracked anywhere: show it as a failure.
    return issues.length ? { status: "known", detail: issues.join(", ") } : { status: "fail" };
  }
  // Only a capability gate (src/capabilities.ts) may skip a test that was meant to run: the
  // lab fails rather than skips. Any other skip note is a failure.
  if (result.state === "skipped" && result.note) {
    return result.note.startsWith("capability:")
      ? { status: "na", detail: result.note }
      : { status: "fail", detail: `skipped: ${result.note}` };
  }
  // Filtered out (`-t`, `.skip`, `.todo`): the test never ran, whatever its siblings did.
  if (test.options.mode !== "run" && test.options.mode !== "only") return { status: "not-run" };
  // Meant to run, but skipped because a hook or its suite failed: a failure, not an absence.
  for (let p = test.parent; p.type !== "module"; p = p.parent) {
    if (p.state() === "failed") return { status: "fail" };
  }
  if (test.module.state() === "failed") return { status: "fail" };
  return { status: "not-run" };
}

function combine(outcomes: Outcome[], tests: string[]): Cell | undefined {
  const ran = outcomes.filter((o) => o.status !== "not-run");
  if (!ran.length) return undefined;
  const details = (s: Status) => [...new Set(ran.filter((o) => o.status === s).map((o) => o.detail))].join(", ");
  if (ran.some((o) => o.status === "fail")) return { status: "fail", text: "FAIL", tests };
  if (ran.some((o) => o.status === "known")) return { status: "known", text: `known (${details("known")})`, tests };
  // A gated test is never hidden behind a passing one in the same cell.
  if (ran.some((o) => o.status === "na")) return { status: "na", text: `n/a (${details("na")})`, tests };
  return { status: "pass", text: "pass", tests };
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function markdown(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function installTarget(): string | undefined {
  const file = join(LAB_STATE, "target.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { label?: string }).label : undefined;
}

export default class MatrixReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): void {
    const scenarios = new Map<string, Map<string, { outcomes: Outcome[]; tests: string[] }>>();
    const unmatched: string[] = [];

    const modules = [...testModules].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
    for (const test of modules.flatMap((m) => [...m.children.allTests()])) {
      const match = NAME.exec(test.fullName);
      const dialect = match?.[1]?.toLowerCase();
      if (!match || !(DIALECTS as readonly string[]).includes(dialect!)) {
        unmatched.push(test.fullName);
        continue;
      }
      const row = scenarios.get(match[2]!) ?? new Map();
      scenarios.set(match[2]!, row);
      const cell = row.get(dialect!) ?? { outcomes: [], tests: [] };
      row.set(dialect!, cell);
      cell.outcomes.push(outcomeOf(test));
      cell.tests.push(test.fullName);
    }

    const rows = [...scenarios].map(([scenario, byDialect]) => ({
      scenario,
      cells: Object.fromEntries(
        DIALECTS.flatMap((d) => {
          const entry = byDialect.get(d);
          const cell = entry && combine(entry.outcomes, entry.tests);
          return cell ? [[d, cell]] : [];
        }),
      ) as Record<string, Cell>,
    }));

    const annotations = ARTIFACT_LIMITS.map((scenario) => ({
      scenario,
      annotation: "not in the schema artifact (fixtures/multi-engine/dataset/NORMALIZATION.md)",
    }));

    const header = ["scenario", ...DIALECTS];
    const cells = [
      ...rows.map((r) => [r.scenario, ...DIALECTS.map((d) => r.cells[d]?.text ?? "-")]),
      ...annotations.map((a) => [`${a.scenario} *`, ...DIALECTS.map(() => ARTIFACT_LIMIT_TEXT)]),
    ];
    const target = installTarget();
    const failed = rows.flatMap((r) => DIALECTS.filter((d) => r.cells[d]?.status === "fail").map((d) => `${r.scenario} [${d}]`));

    const out = [
      "",
      `Consumer lab matrix${target ? ` (target: ${target})` : ""}`,
      "",
      table(header, cells),
      "",
      "- = no test ran for this dialect",
      "* = annotation, not a test result: a golden-schema fact the schema artifact can't express (NORMALIZATION.md)",
    ];
    if (failed.length) out.push("", `${failed.length} FAIL cell(s): ${failed.join(", ")}`);
    if (unmatched.length) {
      out.push("", `Not in the matrix (name doesn't start with "[<dialect>] <scenario-id>"):`, ...unmatched.map((n) => `  ${n}`));
    }
    if (unhandledErrors.length) out.push("", `${unhandledErrors.length} unhandled error(s): see the output above.`);
    console.log(out.join("\n"));

    mkdirSync(LAB_STATE, { recursive: true });
    const json = { target, generatedAt: new Date().toISOString(), dialects: DIALECTS, rows, annotations, unmatched };
    writeFileSync(join(LAB_STATE, "matrix.json"), `${JSON.stringify(json, null, 2)}\n`);

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const verdict = failed.length ? `**${failed.length} FAIL cell(s):** ${failed.join(", ")}\n\n` : "";
      appendFileSync(summary, `### Consumer lab matrix${target ? ` (${target})` : ""}\n\n${markdown(header, cells)}\n\n${verdict}`);
    }
    // Vitest only ever raises the exit code, so this sticks; it never masks vitest's own failures.
    if (failed.length) process.exitCode = 1;
  }
}

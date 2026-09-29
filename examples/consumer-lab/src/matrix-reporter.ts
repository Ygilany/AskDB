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
 * Each `FAIL` cell records why each of its tests failed (the error, or the rule that made a
 * passing test a failure), in `matrix.json` and in the step summary, so CI shows the reason
 * next to the table. Errors outside any test (unhandled errors) are listed too.
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

interface Failure {
  test: string;
  reason: string;
}

interface Cell {
  status: Status;
  text: string;
  tests: string[];
  /** Only on a `FAIL` cell: each failing test and why it failed. */
  failures?: Failure[];
}

interface Outcome {
  status: Status | "not-run";
  detail?: string;
  /** Why a `fail` outcome failed. */
  reason?: string;
}

const MAX_REASON_LINES = 30;
const MAX_REASON_CHARS = 3000;
/** Failures written to the step summary; the rest are in the step log and `matrix.json`. */
const MAX_SUMMARY_FAILURES = 25;
const ANSI = /\u001b\[[0-9;]*m/g;

/** An error's name, message and diff, without colors, cut to a readable length. */
function errorText(errors: ReadonlyArray<SerializedError & { diff?: string }>): string | undefined {
  if (!errors.length) return undefined;
  const text = errors
    .map((e) => [`${e.name && !e.message.startsWith(e.name) ? `${e.name}: ` : ""}${e.message}`, e.diff].filter(Boolean).join("\n"))
    .join("\n\n")
    .replace(ANSI, "");
  const lines = text.split("\n");
  let out = lines.slice(0, MAX_REASON_LINES).join("\n");
  if (out.length > MAX_REASON_CHARS) out = out.slice(0, MAX_REASON_CHARS);
  return out.length < text.length ? `${out}\n… (cut; the full error is in the step log)` : out;
}

function outcomeOf(test: TestCase): Outcome {
  const result = test.result();
  if (result.state === "failed") {
    return { status: "fail", reason: errorText(result.errors) ?? "failed with no error message" };
  }
  if (result.state === "passed") {
    if (!test.options.fails) return { status: "pass" };
    const issues = [...test.name.matchAll(ISSUE)].map((m) => `#${m[1]}`);
    // An expected failure that names no issue isn't tracked anywhere: show it as a failure.
    return issues.length
      ? { status: "known", detail: issues.join(", ") }
      : { status: "fail", reason: "`it.fails` test that names no issue: add the tracking issue as `(#N)` to its name." };
  }
  // Only a capability gate (src/capabilities.ts) may skip a test that was meant to run: the
  // lab fails rather than skips. Any other skip note is a failure.
  if (result.state === "skipped" && result.note) {
    return result.note.startsWith("capability:")
      ? { status: "na", detail: result.note }
      : { status: "fail", detail: `skipped: ${result.note}`, reason: `skipped with a note that isn't a capability gate: ${result.note}` };
  }
  // Filtered out (`-t`, `.skip`, `.todo`): the test never ran, whatever its siblings did.
  if (test.options.mode !== "run" && test.options.mode !== "only") return { status: "not-run" };
  // Meant to run, but skipped because a hook or its suite failed: a failure, not an absence.
  for (let p = test.parent; p.type !== "module"; p = p.parent) {
    if (p.state() === "failed") {
      return { status: "fail", reason: `not run: its suite "${p.fullName}" failed\n${errorText(p.errors()) ?? "(a hook in the suite failed)"}` };
    }
  }
  if (test.module.state() === "failed") {
    return { status: "fail", reason: `not run: its test file failed\n${errorText(test.module.errors()) ?? "(see the step log)"}` };
  }
  return { status: "not-run" };
}

function combine(outcomes: Outcome[], tests: string[]): Cell | undefined {
  const ran = outcomes.filter((o) => o.status !== "not-run");
  if (!ran.length) return undefined;
  const details = (s: Status) => [...new Set(ran.filter((o) => o.status === s).map((o) => o.detail))].join(", ");
  if (ran.some((o) => o.status === "fail")) {
    const failures = outcomes.flatMap((o, i) => (o.status === "fail" ? [{ test: tests[i]!, reason: o.reason ?? "failed" }] : []));
    return { status: "fail", text: "FAIL", tests, failures };
  }
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One collapsible block: a title, and a body shown as preformatted text. */
function details(title: string, body: string): string {
  return `<details><summary>${title}</summary>\n\n<pre>${escapeHtml(body)}</pre>\n\n</details>`;
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
    const failedCells = rows.flatMap((r) =>
      DIALECTS.filter((d) => r.cells[d]?.status === "fail").map((d) => ({ name: `${r.scenario} [${d}]`, cell: r.cells[d]! })),
    );
    const failed = failedCells.map((f) => f.name);
    const unhandled = unhandledErrors.map((e) => errorText([e]) ?? "unhandled error with no message");

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
    const json = { target, generatedAt: new Date().toISOString(), dialects: DIALECTS, rows, annotations, unmatched, unhandledErrors: unhandled };
    writeFileSync(join(LAB_STATE, "matrix.json"), `${JSON.stringify(json, null, 2)}\n`);

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const verdict = failed.length ? `**${failed.length} FAIL cell(s):** ${failed.join(", ")}\n\n` : "";
      const blocks = failedCells
        .flatMap(({ name, cell }) => (cell.failures ?? []).map((f) => details(`<code>${escapeHtml(name)}</code>: ${escapeHtml(f.test)}`, f.reason)));
      const shown = blocks.slice(0, MAX_SUMMARY_FAILURES);
      if (blocks.length > shown.length) shown.push(`…and ${blocks.length - shown.length} more failing test(s): see the step log or \`matrix.json\`.`);
      const why = shown.length ? `#### Why they failed\n\n${shown.join("\n\n")}\n\n` : "";
      const errors = unhandled.length
        ? `**${unhandled.length} unhandled error(s)** (outside any test):\n\n${unhandled.map((u, i) => details(`Unhandled error ${i + 1}`, u)).join("\n\n")}\n\n`
        : "";
      appendFileSync(summary, `### Consumer lab matrix${target ? ` (${target})` : ""}\n\n${markdown(header, cells)}\n\n${verdict}${why}${errors}`);
    }
    // Vitest only ever raises the exit code, so this sticks; it never masks vitest's own failures.
    if (failed.length) process.exitCode = 1;
  }
}

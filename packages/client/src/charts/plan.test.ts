import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { MYSQL_DIALECT, POSTGRES_DIALECT, type NormalizedSchema } from "@askdb/core";
import { classifyResult } from "./classify.js";
import { planChart } from "./plan.js";
import type { ChartSpec, ClassifiedResult } from "./types.js";

type DoGenerate = ConstructorParameters<typeof MockLanguageModelV3>[0] extends infer O
  ? O extends { doGenerate?: infer G } ? G : never
  : never;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function modelReturning(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

function modelFrom(doGenerate: DoGenerate) {
  return new MockLanguageModelV3({ doGenerate });
}

const hangingModel = () =>
  modelFrom(
    (options) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal!.reason));
      }),
  );

// A model that ignores the abort signal and never settles.
const neverSettlingModel = () => modelFrom(() => new Promise(() => {}));

const bar: ChartSpec = { type: "bar", category: "region", series: ["order_count"], title: "Orders by region", description: "Order count per region." };

const byRegion = (): ClassifiedResult =>
  classifyResult({ columns: [{ name: "region" }, { name: "order_count", type: "bigint" }], rowCount: 4 });

const base = { question: "How many orders per region?", sql: "SELECT region, COUNT(*) AS order_count FROM orders GROUP BY region" };

describe("planChart — the prompt carries no rows and no literals", () => {
  it("sends only the question, the masked SQL, and the column names, kinds, row count and truncated flag", async () => {
    const rows = [
      { region: "SENTINEL-ROW-REGION", order_count: 987_654_321, placed_on: "1999-12-31" },
      { region: "Another-Sentinel", order_count: 123_456_789, placed_on: "1999-12-30" },
    ];
    const result = classifyResult({
      columns: [{ name: "region" }, { name: "order_count", type: "bigint" }, { name: "placed_on" }],
      rowCount: 2,
      truncated: true,
      rows,
    });
    const sql =
      "SELECT region, COUNT(*) AS order_count, placed_on FROM orders WHERE tenant_id = 'SENTINEL-TENANT-77' AND total > 31337 AND note = $tag$SENTINEL-DOLLAR$tag$ /* SENTINEL-COMMENT */ GROUP BY region, placed_on";
    const model = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
    await planChart({ question: "How many orders per region?", sql, result, model, dialect: "postgres" });

    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = model.doGenerateCalls[0]!.prompt;
    const sent = JSON.stringify(prompt);
    for (const value of ["SENTINEL", "Another-Sentinel", "987654321", "123456789", "1999-12", "31337"]) {
      expect(sent).not.toContain(value);
    }
    const user = prompt.find((m) => m.role === "user")!;
    expect(user.content).toEqual([
      {
        type: "text",
        text: [
          "Question: How many orders per region?",
          "",
          "SQL (literals replaced with ?):",
          "SELECT region, COUNT(*) AS order_count, placed_on FROM orders WHERE tenant_id = ? AND total > ? AND note = ?   GROUP BY region, placed_on",
          "",
          "Result shape: 2 rows (truncated: more rows exist than the host returned).",
          "Columns:",
          "- region (category)",
          "- order_count (measure)",
          "- placed_on (date)",
        ].join("\n"),
      },
    ]);
  });

  it("sends no SQL at all when the SQL can't be read safely", async () => {
    const model = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
    await planChart({ ...base, sql: "SELECT region FROM t WHERE name = 'SENTINEL-UNCLOSED", result: byRegion(), model });
    const sent = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(sent).not.toContain("SENTINEL");
    expect(sent).toContain("SQL: not shown");
  });

  it("shows a column name that holds a literal under a neutral label, and maps the model's answer back", async () => {
    // SQLite and MySQL name an unaliased expression by its own text.
    const name = "COUNT(CASE WHEN status = 'SENTINEL-STATUS' THEN 1 END)";
    const result = classifyResult({ columns: [{ name: "region" }, { name, type: "bigint" }], rowCount: 4 });
    const model = modelReturning(JSON.stringify({ primary: { ...bar, series: ["column_2"] }, alternate: null }));
    const plan = await planChart({ ...base, result, model, dialect: "sqlite" });
    const sent = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(sent).not.toContain("SENTINEL");
    expect(sent).toContain("- column_2 (measure)");
    expect(plan).toMatchObject({ source: "model", primary: { series: [name] } });
  });

  it("keeps sensitive names out under omission: no SQL that mentions one, and a label for the column", async () => {
    const schema: NormalizedSchema = {
      tables: [{ name: "patients", columns: [{ name: "diagnosis", type: "text", nullable: true, primaryKey: false, sensitive: true }, { name: "id", type: "int", nullable: false, primaryKey: true }] }],
    };
    const result = classifyResult({ columns: [{ name: "diagnosis" }, { name: "patient_count", type: "bigint" }], rowCount: 3 });
    const sql = "SELECT diagnosis, COUNT(*) AS patient_count FROM patients GROUP BY diagnosis";
    const omitted = modelReturning(JSON.stringify({ primary: { ...bar, category: "column_1", series: ["patient_count"] }, alternate: null }));
    const plan = await planChart({ ...base, sql, result, model: omitted, schema, omitSensitiveIdentifiers: true });
    const sent = JSON.stringify(omitted.doGenerateCalls[0]!.prompt);
    expect(sent).not.toContain("diagnosis");
    expect(sent).toContain("SQL: not shown");
    expect(plan).toMatchObject({ source: "model", primary: { category: "diagnosis" } });

    const tagged = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
    await planChart({ ...base, sql, result, model: tagged, schema });
    expect(JSON.stringify(tagged.doGenerateCalls[0]!.prompt)).toContain("diagnosis");
  });

  it("reads the SQL under the dialect it's given: an id, a spec or a custom dialect", async () => {
    const sql = `SELECT "SENTINEL-NAME" AS region, COUNT(*) AS order_count FROM t GROUP BY 1`;
    const sentFor = async (dialect: Parameters<typeof planChart>[0]["dialect"]) => {
      const model = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
      await planChart({ ...base, sql, result: byRegion(), model, dialect });
      return JSON.stringify(model.doGenerateCalls[0]!.prompt);
    };
    // Postgres reads "…" as a name, so it stays; MySQL, a custom dialect and none read a string.
    expect(await sentFor("postgres")).toContain("SENTINEL-NAME");
    expect(await sentFor(POSTGRES_DIALECT)).toContain("SENTINEL-NAME");
    expect(await sentFor(MYSQL_DIALECT)).not.toContain("SENTINEL-NAME");
    expect(await sentFor({ generate: async () => ({ sql: "SELECT 1" }) })).not.toContain("SENTINEL-NAME");
    expect(await sentFor(undefined)).not.toContain("SENTINEL-NAME");
  });

  it("states the rubric and the rules in the system prompt", async () => {
    const model = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
    await planChart({ ...base, result: byRegion(), model });
    const system = model.doGenerateCalls[0]!.prompt.find((m) => m.role === "system")!.content as string;
    for (const rule of [
      /one row with one headline number: metric/i,
      /measure over ordered time.*: line/i,
      /use area only when the filled volume is the point/i,
      /part of a whole across 2–8 categories: pie/i,
      /a ranking .*: horizontal-bar/i,
      /a few short categories: bar/i,
      /never invent a column, a formula or an aggregation/i,
      /an identifier or a year is a category, never a series/i,
      /keep titles and descriptions factual/i,
    ]) {
      expect(system).toMatch(rule);
    }
  });
});

describe("planChart — the model's spec", () => {
  it("returns a valid spec as the model's, with the alternate", async () => {
    const alternate: ChartSpec = { ...bar, type: "horizontal-bar" };
    const plan = await planChart({ ...base, result: byRegion(), model: modelReturning(JSON.stringify({ primary: bar, alternate })) });
    expect(plan).toMatchObject({ primary: bar, alternate, source: "model" });
    expect(plan.fallbackReason).toBeUndefined();
    expect(plan.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("drops an invalid alternate and keeps the primary", async () => {
    const alternate: ChartSpec = { ...bar, series: ["invented"] };
    const plan = await planChart({ ...base, result: byRegion(), model: modelReturning(JSON.stringify({ primary: bar, alternate })) });
    expect(plan.source).toBe("model");
    expect(plan.alternate).toBeUndefined();
  });

  it("forwards providerOptions to the model call", async () => {
    const model = modelReturning(JSON.stringify({ primary: bar, alternate: null }));
    await planChart({ ...base, result: byRegion(), model, providerOptions: { openai: { reasoningEffort: "low" } } });
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({ openai: { reasoningEffort: "low" } });
  });
});

describe("planChart — the fallback", () => {
  it("falls back on an invalid spec and reports why", async () => {
    const invalid = { ...bar, series: ["revenue"] };
    const plan = await planChart({ ...base, result: byRegion(), model: modelReturning(JSON.stringify({ primary: invalid, alternate: null })) });
    expect(plan).toMatchObject({ source: "fallback", fallbackReason: "invalid-spec", primary: { type: "bar", category: "region", series: ["order_count"] } });
    expect(plan.issues?.map((i) => i.code)).toEqual(["UNKNOWN_COLUMN"]);
  });

  it("falls back when the model returns something that isn't the spec's JSON", async () => {
    for (const text of ["not json", JSON.stringify({ primary: { type: "radar" } })]) {
      const plan = await planChart({ ...base, result: byRegion(), model: modelReturning(text) });
      expect(plan).toMatchObject({ source: "fallback", fallbackReason: "invalid-spec" });
    }
  });

  it("falls back when the model call throws", async () => {
    const model = modelFrom(async () => {
      throw new Error("provider down");
    });
    const plan = await planChart({ ...base, result: byRegion(), model });
    expect(plan).toMatchObject({ source: "fallback", fallbackReason: "model-error" });
  });

  it("falls back on a timeout", async () => {
    const plan = await planChart({ ...base, result: byRegion(), model: hangingModel(), timeoutMs: 20 });
    expect(plan).toMatchObject({ source: "fallback", fallbackReason: "timeout", primary: { type: "bar" } });
  });

  it("falls back on a timeout even when the model ignores the signal and never settles", async () => {
    const plan = await planChart({ ...base, result: byRegion(), model: neverSettlingModel(), timeoutMs: 20 });
    expect(plan).toMatchObject({ source: "fallback", fallbackReason: "timeout" });
    const controller = new AbortController();
    const pending = planChart({ ...base, result: byRegion(), model: neverSettlingModel(), abortSignal: controller.signal, timeoutMs: Infinity });
    controller.abort();
    expect(await pending).toMatchObject({ source: "fallback", fallbackReason: "aborted" });
  });

  it("never rejects for a timeoutMs a timer can't take", async () => {
    for (const timeoutMs of [12.5, -1, Number.NaN, 2 ** 40]) {
      const plan = await planChart({ ...base, result: byRegion(), model: modelReturning(JSON.stringify({ primary: bar, alternate: null })), timeoutMs });
      expect(plan.source).toBe("model");
    }
  });

  it("falls back when the host aborts", async () => {
    const controller = new AbortController();
    const pending = planChart({ ...base, result: byRegion(), model: hangingModel(), abortSignal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ source: "fallback", fallbackReason: "aborted" });
  });

  it("returns no chart when no column can be plotted", async () => {
    const result = classifyResult({ columns: [{ name: "region" }, { name: "customer_id" }], rowCount: 3 });
    const plan = await planChart({ ...base, result, model: modelReturning("nope") });
    expect(plan).toMatchObject({ source: "fallback", primary: null });
  });
});

// The rubric, through the deterministic fallback: a fake model can't test the model's judgment.
describe("planChart — the rubric (fallback)", () => {
  const fallbackFor = async (question: string, result: ClassifiedResult) =>
    (await planChart({ question, sql: "SELECT 1", result, model: modelReturning("{}") })).primary;

  it("one row with one number: metric", async () => {
    const result = classifyResult({ columns: [{ name: "total_revenue", type: "numeric" }], rowCount: 1 });
    expect(await fallbackFor("What was revenue last year?", result)).toMatchObject({ type: "metric", series: ["total_revenue"] });
  });

  it("a measure over time: line", async () => {
    const result = classifyResult({ columns: [{ name: "order_month" }, { name: "revenue", type: "numeric" }], rowCount: 12 });
    expect(await fallbackFor("Revenue by month", result)).toMatchObject({ type: "line", category: "order_month", series: ["revenue"] });
  });

  it("part of a whole across 2–8 categories: pie", async () => {
    expect(await fallbackFor("What share of orders does each region have?", byRegion())).toMatchObject({ type: "pie", category: "region" });
  });

  it("part of a whole that fails the policy: bar instead", async () => {
    const result = classifyResult({ columns: [{ name: "region" }, { name: "order_count", type: "int" }], rowCount: 12 });
    expect(await fallbackFor("What share of orders does each region have?", result)).toMatchObject({ type: "bar" });
  });

  it("a ranking: horizontal bar", async () => {
    expect(await fallbackFor("Top 5 regions by orders", byRegion())).toMatchObject({ type: "horizontal-bar" });
  });

  it("a few short categories: bar; long labels: horizontal bar", async () => {
    expect(await fallbackFor("Orders per region", byRegion())).toMatchObject({ type: "bar", title: "Order count by region" });
    const long = classifyResult({
      columns: [{ name: "region" }, { name: "order_count", type: "int" }],
      rowCount: 2,
      rows: [{ region: "North America and the Caribbean", order_count: 1 }, { region: "Europe", order_count: 2 }],
    });
    expect(await fallbackFor("Orders per region", long)).toMatchObject({ type: "horizontal-bar" });
  });

  it("prefers a category over an identifier", async () => {
    const result = classifyResult({ columns: [{ name: "customer_id" }, { name: "segment" }, { name: "spend", type: "numeric" }], rowCount: 6 });
    expect(await fallbackFor("Spend per segment", result)).toMatchObject({ category: "segment", series: ["spend"] });
  });

  it("plots a year as the time axis, never as a series", async () => {
    const result = classifyResult({ columns: [{ name: "customer_id" }, { name: "fiscal_year" }, { name: "spend", type: "numeric" }], rowCount: 6 });
    expect(await fallbackFor("Spend per year", result)).toMatchObject({ type: "line", category: "fiscal_year", series: ["spend"] });
  });
});

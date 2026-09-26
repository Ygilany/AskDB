/**
 * `pnpm lab <command>`: the maintainer's entry point to the consumer lab.
 *
 *   pnpm lab ask --db postgres --sql "SELECT …" ["question"]
 *
 * Sends the SQL through AskDB's public `ask()` as if a model had written it, prints the
 * SQL and the validation outcome, then executes accepted SQL on the fixture as the
 * read-only role and prints the rows. Rejected SQL is never executed.
 */
import { parseArgs } from "node:util";
import { ask, loadSchema } from "@askdb/core";
import { ensureArtifact, installTarget } from "./artifacts.js";
import { DIALECTS, type Dialect } from "./fixture.js";
import { executeReadOnly, type ExecuteResult } from "./host/execute.js";

const USAGE = `usage: pnpm lab ask --db <${DIALECTS.join("|")}> --sql "<sql>" ["question"]`;

/**
 * The documented `deps.generateText` seam: a "model" that always answers with this SQL,
 * fenced the way a model reply is.
 */
function fixedSqlReply(sql: string) {
  return (async () => ({ text: `\`\`\`sql\n${sql}\n\`\`\`` })) as never;
}

function formatRows(result: ExecuteResult): string {
  const cells = [result.columns, ...result.rows.map((row) => row.map((v) => (v === null ? "NULL" : String(v))))];
  const widths = result.columns.map((_, i) => Math.max(...cells.map((r) => (r[i] as string).length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const header = line(cells[0] as string[]);
  const count = `${result.total} ${result.total === 1 ? "row" : "rows"}${result.truncated ? ` (showing ${result.rows.length})` : ""}`;
  return [header, "-".repeat(header.length), ...cells.slice(1).map((r) => line(r as string[])), "", count].join("\n");
}

async function askCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { db: { type: "string" }, sql: { type: "string" } },
    allowPositionals: true,
  });
  const dialect = values.db as Dialect | undefined;
  if (!dialect || !(DIALECTS as readonly string[]).includes(dialect)) {
    console.error(USAGE);
    return 2;
  }
  if (!values.sql) {
    console.error(`${USAGE}\n(answering questions with a model arrives in #243; for now pass --sql)`);
    return 2;
  }
  const question = positionals.join(" ") || "Run the SQL supplied with --sql.";

  console.log(`target:     ${installTarget().label}`);
  console.log(`dialect:    ${dialect}`);
  const schema = loadSchema(ensureArtifact(dialect));

  let result: Awaited<ReturnType<typeof ask>>;
  try {
    result = await ask({ question, schema, model: {} as never, dialect, deps: { generateText: fixedSqlReply(values.sql) } });
  } catch (error) {
    const err = error as Error & { rule?: string };
    console.log(`sql:        ${values.sql}`);
    console.log(`validation: rejected — ${err.constructor.name}${err.rule ? ` ${err.rule}` : ""}`);
    console.log(`            ${err.message}`);
    return 1;
  }

  console.log(`sql:        ${result.sql}`);
  if (result.unboundSql) console.log(`unbound:    ${result.unboundSql}  params: ${JSON.stringify(result.params ?? [])}`);
  console.log("validation: ok");
  if (result.sensitiveGuardrail && !result.sensitiveGuardrail.passed) {
    console.log(`sensitive:  ${JSON.stringify(result.sensitiveGuardrail.references)}`);
  }
  console.log("");
  console.log(formatRows(await executeReadOnly(dialect, result.sql)));
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "ask") return askCommand(rest);
  console.error(USAGE);
  return 2;
}

process.exitCode = await main();

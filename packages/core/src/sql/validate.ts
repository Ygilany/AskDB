import type { SqlValidationRuleCode } from "../errors.js";
import { SqlValidationError } from "../errors.js";

const FORBIDDEN = new Set([
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "analyze",
  "copy",
  "call",
]);

function validationError(rule: SqlValidationRuleCode, summary: string, hint: string): SqlValidationError {
  return new SqlValidationError(summary, rule, hint);
}

/**
 * Phase-1 dev guardrails: single-statement read shape. Not a SQL parser;
 * blocks obvious foot-guns and multi-statement abuse.
 */
export function validatePostgresSelectSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw validationError(
      "SQL_EMPTY",
      "Generated SQL is empty after extraction.",
      "The model reply had no usable ```sql fenced block or the block was blank. Retry with a clearer question or inspect the raw model output with logging.",
    );
  }
  const withoutStrings = stripSqlStringLiterals(trimmed);
  if (/;/.test(withoutStrings)) {
    const parts = withoutStrings.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      throw validationError(
        "SQL_MULTI_STATEMENT",
        "Multiple SQL statements are not allowed (semicolon separates more than one statement).",
        "Ask for a single SELECT (WITH … SELECT allowed). Split analytical steps into separate questions or use a CTE instead of multiple statements.",
      );
    }
  }
  if (/--|\/\*/.test(withoutStrings)) {
    throw validationError(
      "SQL_COMMENT",
      "SQL comments (-- or /* … */) are not allowed under current guardrails.",
      "Remove comments from generated SQL; rely on clear column aliases and CTE names instead.",
    );
  }

  const head = firstMeaningfulToken(withoutStrings);
  if (head !== "select" && head !== "with") {
    throw validationError(
      "SQL_NOT_SELECT_OR_WITH",
      `SQL must start with SELECT or WITH (got '${head || "none"}').`,
      "Regenerate as a read-only SELECT (optionally with WITH). INSERT/UPDATE/DELETE and procedural calls are blocked in dev guardrails.",
    );
  }

  const lower = withoutStrings.toLowerCase();
  for (const word of FORBIDDEN) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(lower)) {
      throw validationError(
        "SQL_FORBIDDEN_KEYWORD",
        `Forbidden keyword in generated SQL: ${word.toUpperCase()}.`,
        `Matched whole-word guardrail keyword "${word}". This build allows read-only SELECT shape only; DDL/DML and similar verbs are rejected.`,
      );
    }
  }

  return trimmed.replace(/;\s*$/, "").trim();
}

/** Explanation of guardrails satisfied by a string already passing {@link validatePostgresSelectSql}. */
export type PostgresSelectGuardrailExplain = {
  statementKind: "select" | "with";
  checksVerified: readonly string[];
  remediationNote: string;
};

/** Build a structured summary for hosts/CLI `--explain`; input must already be validated. */
export function buildPostgresSelectGuardrailExplanation(validatedSql: string): PostgresSelectGuardrailExplain {
  const trimmed = validatedSql.trim();
  const head = firstMeaningfulToken(stripSqlStringLiterals(trimmed));
  const statementKind: "select" | "with" = head === "with" ? "with" : "select";
  return {
    statementKind,
    checksVerified: [
      "non_empty_sql",
      "single_statement",
      "no_line_or_block_comments",
      "leading_select_or_with",
      "no_blocked_write_or_ddl_keywords",
    ],
    remediationNote:
      "Heuristic Phase-2 checks only—not a full SQL parser or production policy engine. Always review before trusted execution.",
  };
}

function stripSqlStringLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') {
        if (sql[i] === "\\") i++;
        i++;
      }
      if (i < sql.length) i++;
      out += '""';
      continue;
    }
    if (ch === "$" && /^\$\w*\$/.test(sql.slice(i))) {
      const end = sql.indexOf("$", i + 1);
      const tagEnd = sql.indexOf("$", end + 1);
      if (tagEnd === -1) return out + sql.slice(i);
      i = tagEnd + 1;
      out += "$$";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function firstMeaningfulToken(withoutStrings: string): string {
  const token = /([a-zA-Z_][\w$]*|"[^"]*")/.exec(withoutStrings.trim());
  if (!token) return "";
  let t = token[1]!;
  if (t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1);
  }
  return t.toLowerCase();
}

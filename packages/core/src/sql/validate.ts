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

/**
 * Phase-1 dev guardrails: single-statement read shape. Not a SQL parser;
 * blocks obvious foot-guns and multi-statement abuse.
 */
export function validatePostgresSelectSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new SqlValidationError("Generated SQL is empty.");
  }
  const withoutStrings = stripSqlStringLiterals(trimmed);
  if (/;/.test(withoutStrings)) {
    const parts = withoutStrings.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      throw new SqlValidationError("Multiple SQL statements are not allowed (found ';').");
    }
  }
  if (/--|\/\*/.test(withoutStrings)) {
    throw new SqlValidationError("SQL comments (-- or /*) are not allowed in Phase 1 guardrails.");
  }

  const head = firstMeaningfulToken(withoutStrings);
  if (head !== "select" && head !== "with") {
    throw new SqlValidationError(`SQL must start with SELECT or WITH (got '${head || "none"}').`);
  }

  const lower = withoutStrings.toLowerCase();
  for (const word of FORBIDDEN) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(lower)) {
      throw new SqlValidationError(`Forbidden keyword in generated SQL: ${word.toUpperCase()}.`);
    }
  }

  return trimmed.replace(/;\s*$/, "").trim();
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

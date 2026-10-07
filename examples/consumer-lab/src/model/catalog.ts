/**
 * The lab's question catalog (`scenarios/questions.json`) and its cassettes
 * (`cassettes/<dialect>/<question-id>.json`): one model reply per question and dialect.
 * Node built-ins only; the replay server loads these, and it never imports AskDB.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LAB_ROOT } from "../paths.js";

export const QUESTIONS_FILE = join(LAB_ROOT, "scenarios", "questions.json");
export const CASSETTES_DIR = join(LAB_ROOT, "cassettes");

export interface Question {
  /** Also the cassette's file name. */
  id: string;
  /** Unique across the catalog; the replay server finds it inside the prompt. */
  text: string;
}

export interface Cassette {
  question: string;
  /** The model's whole reply, fences included. */
  reply: string;
  /** `authored`: hand-written SQL. `recorded`: a live model's reply (#247). */
  source: "authored" | "recorded";
  recordedWith?: { model: string; askdbTarget: string; at: string };
}

export function loadQuestions(file = QUESTIONS_FILE): Question[] {
  return JSON.parse(readFileSync(file, "utf8")) as Question[];
}

export function findQuestion(id: string, questions = loadQuestions()): Question | undefined {
  return questions.find((q) => q.id === id);
}

/**
 * The id of the catalog question whose text this is (ignoring surrounding whitespace), or
 * undefined for any other text: how `lab ask` and `lab ui` tell a catalog question, which has
 * an oracle, from free text.
 */
export function catalogQuestionId(text: string, questions = loadQuestions()): string | undefined {
  return questions.find((q) => q.text === text.trim())?.id;
}

export function cassettePath(dialect: string, questionId: string, dir = CASSETTES_DIR): string {
  return join(dir, dialect, `${questionId}.json`);
}

/** A path to show in messages: relative to the lab when it's inside it. */
export function displayPath(path: string): string {
  const rel = relative(LAB_ROOT, path);
  return rel.startsWith("..") ? path : `examples/consumer-lab/${rel}`;
}

/** The cassette for a question on a dialect, or undefined when none has been added. */
export function readCassette(dialect: string, question: Question, dir = CASSETTES_DIR): Cassette | undefined {
  const path = cassettePath(dialect, question.id, dir);
  if (!existsSync(path)) return undefined;
  const cassette = JSON.parse(readFileSync(path, "utf8")) as Cassette;
  if (cassette.question !== question.text) {
    throw new Error(
      `${displayPath(path)} answers "${cassette.question}", but the catalog's ${question.id} asks "${question.text}". ` +
        "Update the cassette's question (and check its reply still answers it).",
    );
  }
  return cassette;
}

/**
 * SQL without a single trailing `;`. A model's reply usually ends with one. Released AskDB removes
 * it from the SQL it returns (`concepts/safety-boundaries.mdx`, "Single statement"); #477 keeps it.
 * The lab compares SQL with it removed on both sides, so it reads either behavior, and still sees
 * a `;` anywhere else or any other change to the statement.
 */
export function withoutTerminator(sql: string): string {
  return sql.trim().replace(/;$/, "").trimEnd();
}

/** The SQL inside a reply's first ```sql fence, without its terminator, read the way the replay suites read a cassette. */
export function fencedSql(reply: string): string | undefined {
  const sql = /```sql\n([\s\S]*?)\n```/.exec(reply)?.[1];
  return sql === undefined ? undefined : withoutTerminator(sql);
}

/** The SQL inside a cassette's ```sql fence, without its terminator: what AskDB should return for that question on that dialect. */
export function cassetteSql(dialect: string, questionId: string, questions = loadQuestions()): string {
  const question = findQuestion(questionId, questions);
  const cassette = question && readCassette(dialect, question);
  const sql = cassette && fencedSql(cassette.reply);
  if (!sql) throw new Error(`no \`\`\`sql reply for ${questionId} on ${dialect} in ${displayPath(cassettePath(dialect, questionId))}`);
  return sql;
}

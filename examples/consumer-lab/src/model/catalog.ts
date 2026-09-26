/**
 * The lab's question catalog (`scenarios/questions.json`) and its cassettes
 * (`cassettes/<dialect>/<question-id>.json`): one model reply per question and dialect.
 * Node built-ins only; the replay server loads these, and it never imports AskDB.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const LAB_ROOT = fileURLToPath(new URL("../..", import.meta.url));
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

/**
 * What `lab ui`'s summary strip says about one input run on every engine: whether the
 * engines agree, and whether each matches the oracle. Both compare rows only through the
 * fixture's normalization rules (`normalizeRows`, `dataset/NORMALIZATION.md`), which need
 * each column's logical type. Only a catalog question's oracle (`src/oracle.ts`) declares
 * those, so an input that isn't a catalog question (or raw SQL not labelled with one) is
 * shown, not compared. On the live model, an engine's oracle verdict is the grader's
 * (`gradeCatalogAnswer`, `src/grade.ts`), the one its column prints, which checks more than
 * the rows (the parameterized form, a rejection's reason).
 */
import type { AskRunStatus } from "../ask-run.js";
import type { SupportedDialect } from "../dialects.js";
import { normalizeRows } from "../fixture.js";
import type { Verdict as GradeVerdict } from "../grade.js";
import type { ExecuteResult } from "../host/execute.js";
import { catalogQuestionId } from "../model/catalog.js";
import { ORACLES } from "../oracle.js";

export interface EngineRows {
  dialect: SupportedDialect;
  /** The rows the read-only role read; absent when the engine didn't get that far. */
  rows?: ExecuteResult;
  /** Why there are no rows, shown when it isn't compared. */
  status: AskRunStatus | "timeout";
  /** The grader's verdict, on a live answer to a catalog question. */
  verdict?: GradeVerdict;
}

export type Verdict =
  | { verdict: "match" | "mismatch"; reason?: string }
  | { verdict: "not compared"; reason: string };

export interface Summary {
  /** The catalog question the input is (or is labelled with), if any. */
  questionId: string | null;
  agreement: {
    verdict: "agree" | "disagree" | "not compared";
    reason?: string;
    /** Engines whose normalized rows are equal, one group each. */
    groups: SupportedDialect[][];
    notCompared: { dialect: SupportedDialect; reason: string }[];
  };
  /** Per engine; null when the input isn't a catalog question. */
  oracle: Partial<Record<SupportedDialect, Verdict>> | null;
}

const NO_TYPES = "not a catalog question: only the catalog's oracle declares the column types normalization needs";

export function summarize(question: string, engines: EngineRows[]): Summary {
  const questionId = catalogQuestionId(question) ?? null;
  const oracle = questionId ? ORACLES[questionId] : undefined;
  if (!oracle) {
    return {
      questionId,
      agreement: { verdict: "not compared", reason: NO_TYPES, groups: [], notCompared: [] },
      oracle: null,
    };
  }

  const normalize = (rows: readonly (readonly unknown[])[]) => JSON.stringify(normalizeRows(rows, oracle.types, { ordered: oracle.ordered }));
  const expected = normalize(oracle.rows());
  const groups = new Map<string, SupportedDialect[]>();
  const notCompared: Summary["agreement"]["notCompared"] = [];
  const verdicts: Partial<Record<SupportedDialect, Verdict>> = {};

  for (const { dialect, rows, status } of engines) {
    if (!rows || rows.truncated) {
      const reason = rows ? "the row cap cut the result" : status;
      notCompared.push({ dialect, reason });
      verdicts[dialect] = { verdict: "not compared", reason };
      continue;
    }
    let key: string;
    try {
      key = normalize(rows.rows);
    } catch (error) {
      // Rows that don't fit the question's column types can't be compared with any engine's;
      // when the SQL doesn't fit its label, that's true of every engine, so it isn't a disagreement.
      const reason = `rows don't fit the question's columns: ${error instanceof Error ? error.message : String(error)}`;
      notCompared.push({ dialect, reason });
      verdicts[dialect] = { verdict: "mismatch", reason };
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), dialect]);
    verdicts[dialect] = key === expected ? { verdict: "match" } : { verdict: "mismatch" };
  }

  // The grader judged the live answers: its verdict is the oracle's, as the column says.
  for (const { dialect, verdict } of engines) {
    if (verdict) verdicts[dialect] = verdict.status === "pass" ? { verdict: "match" } : { verdict: "mismatch", reason: verdict.reason };
  }

  const compared = [...groups.values()];
  const agreement: Summary["agreement"] =
    compared.flat().length < 2
      ? { verdict: "not compared", reason: "fewer than two engines returned rows to compare", groups: compared, notCompared }
      : { verdict: compared.length === 1 ? "agree" : "disagree", groups: compared, notCompared };
  return { questionId, agreement, oracle: verdicts };
}

import type { LanguageModel } from "ai";
import { generateText as defaultGenerateText } from "ai";
import { SqlGenerationError } from "../errors.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import type { FormatNlToSqlOptions } from "../schema/normalize.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import type { DialectSpec } from "./dialect-spec.js";
import { extractSqlFromModelText } from "./extract-sql.js";
import { buildNlToSqlSystemPrompt, buildNlToSqlUserPrompt } from "./prompt.js";
import { assertNlToSqlInputs, nlToSqlAmbiguityNotes } from "./schema-question-precheck.js";
import { validateTenantGuardrails, type TenantGuardrailResult } from "./tenant-guardrail.js";
import {
  buildSelectGuardrailExplanation,
  validateSelectSql,
  type SelectGuardrailExplain,
} from "./validate.js";

export type GenerateSqlDeps = {
  generateText?: typeof defaultGenerateText;
  logger?: AskDbLogger;
  /** When true, include heuristic guardrail explanation in {@link GenerateSelectSqlResult.explain}. */
  explain?: boolean;
  /**
   * When true, omit sensitive identifiers from NL→SQL DDL (stricter). Default false — names are listed
   * with `(sensitive)` so the model can ground queries (see `docs/contracts/sensitive-fields-and-modes.md`).
   */
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  /**
   * Pre-synthesized DDL block. When supplied, replaces the formatter output
   * in the NL→SQL prompt. Used by `ask({ retriever })` to inject a focused
   * DDL synthesized from retrieved chunks; consumers usually don't set this
   * directly.
   */
  prebuiltDdl?: string;
  /** Normalized tenant policy from the schema artifact. Forwarded from ask(). */
  tenantPolicy?: NormalizedTenantPolicy;
  /** Validated tenant scope from the host. Forwarded from ask(). */
  tenantScope?: TenantScope;
};

/** Result of NL→SQL generation (always includes `sql`; `explain` when {@link GenerateSqlDeps.explain}). */
export type GenerateSelectSqlResult = {
  sql: string;
  explain?: SelectGuardrailExplain;
  tenantGuardrail?: TenantGuardrailResult;
};

/**
 * Dialect-parameterized NL→SQL generator. Validates inputs, builds the user/system
 * prompt with the dialect's syntax brief, calls the model, extracts the fenced SQL,
 * and runs the shared read-only validator (plus any dialect-specific `extraValidate`).
 */
export async function generateSelectSql(
  dialect: DialectSpec,
  question: string,
  schema: AnyNormalizedSchema,
  model: LanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<GenerateSelectSqlResult> {
  assertNlToSqlInputs(schema, question);
  const ambiguityNotes = nlToSqlAmbiguityNotes(question, schema);
  const generateText = deps.generateText ?? defaultGenerateText;
  const logger = deps.logger;
  const nlToSqlSchemaOptions: FormatNlToSqlOptions | undefined =
    deps.omitSensitiveIdentifiersFromNlToSqlPrompt === true
      ? { omitSensitiveIdentifiersFromPrompt: true }
      : undefined;

  logger?.info(
    {
      event: AskDbLogEvent.PipelineGenerateStart,
      questionLength: question.length,
      tableCount: schema.tables.length,
    },
    "nl-to-sql generate start",
  );

  try {
    let text: string;
    try {
      const result = await generateText({
        model,
        system: buildNlToSqlSystemPrompt(dialect),
        prompt: buildNlToSqlUserPrompt(
          dialect,
          question,
          schema,
          ambiguityNotes,
          logger,
          nlToSqlSchemaOptions,
          deps.prebuiltDdl,
          deps.tenantPolicy,
          deps.tenantScope,
        ),
        temperature: 0,
      });
      text = result.text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SqlGenerationError(`Model call failed: ${message}`, e);
    }
    const extracted = extractSqlFromModelText(text);
    const sql = validateSelectSql(dialect, extracted);

    // Tenant guardrail validation (after base validation, before returning)
    let tenantGuardrail: TenantGuardrailResult | undefined;
    if (deps.tenantPolicy && deps.tenantScope) {
      tenantGuardrail = validateTenantGuardrails(sql, deps.tenantPolicy, deps.tenantScope);
      if (tenantGuardrail.passed) {
        logger?.info(
          { event: AskDbLogEvent.TenantGuardrailPassed },
          "tenant guardrail validation passed",
        );
      } else {
        logger?.info(
          {
            event: AskDbLogEvent.TenantGuardrailFailed,
            warningCount: tenantGuardrail.warnings.length,
            enforcement: deps.tenantPolicy.enforcement,
          },
          "tenant guardrail validation found issues",
        );
      }
    }

    const explain = deps.explain ? buildSelectGuardrailExplanation(sql) : undefined;
    logger?.info(
      {
        event: AskDbLogEvent.PipelineGenerateComplete,
        sqlCharCount: sql.length,
      },
      "nl-to-sql generate complete",
    );
    const result: GenerateSelectSqlResult = { sql };
    if (explain !== undefined) result.explain = explain;
    if (tenantGuardrail !== undefined) result.tenantGuardrail = tenantGuardrail;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.error(
      {
        event: AskDbLogEvent.PipelineFailed,
        phase: "generate",
        errMessage: msg,
      },
      "nl-to-sql generate failed",
    );
    throw e;
  }
}

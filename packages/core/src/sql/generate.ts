import { generateText as defaultGenerateText } from "ai";
import type { AskDbLanguageModel } from "../ai/types.js";
import { SqlGenerationError, SqlValidationError, type GuardrailVerdict } from "../errors.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import type { FormatNlToSqlOptions } from "../schema/normalize.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import type { DialectSpec } from "./dialect-spec.js";
import { extractSqlFromModelText, extractUnboundSqlFromModelText } from "./extract-sql.js";
import {
  crossValidateManifestAgainstSql,
  parseParameterManifest,
  type ParameterManifest,
} from "./parameter-manifest.js";
import { buildNlToSqlSystemPrompt, buildNlToSqlUserPrompt } from "./prompt.js";
import { assertNlToSqlInputs, nlToSqlAmbiguityNotes } from "./schema-question-precheck.js";
import { decide, tenantGuardrailResult, throwIfDenied, type GuardrailModes } from "./guardrail-decide.js";
import { evaluateGuardrails, logGuardrailVerdict } from "./guardrails.js";
import type { TenantGuardrailResult } from "./tenant-guardrail.js";
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
  /**
   * Forwarded verbatim to the underlying `generateText` call's `providerOptions`.
   * Resolve provider-portable reasoning/latency effort (e.g. via `@askdb/ai`'s
   * `resolveProviderOptions`) and pass the result here — core stays BYO-model
   * and does not interpret or validate this bag. Omitted entirely (not sent
   * as an empty object) when unset, so existing `generateText` call shapes
   * are unaffected.
   */
  providerOptions?: Record<string, unknown>;
  /** Forwarded to the `generateText` call; an aborted call rejects with `SqlGenerationError`. */
  abortSignal?: AbortSignal;
  /**
   * When true, ask the model for unbound SQL + parameter manifest and return
   * them as optional extras when valid. Forwarded from ask(); default decided there.
   */
  parameterize?: boolean;
};

/** Result of NL→SQL generation (always includes `sql`; `explain` when {@link GenerateSqlDeps.explain}). */
export type GenerateSelectSqlResult = {
  sql: string;
  explain?: SelectGuardrailExplain;
  /** The read-only and (with a tenant policy and scope) tenant findings, and the outcome. */
  verdict: GuardrailVerdict;
  /** Tenant guardrail result, derived from {@link verdict}. Present with a tenant policy and scope. */
  tenantGuardrail?: TenantGuardrailResult;
  /** Token usage for the generation call. Populated when the model provider returns usage data. */
  usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  /** Named-placeholder SQL from the ```sql-unbound fence, when parameterize succeeded. */
  unboundNamedSql?: string;
  /** Validated parameter manifest, when parameterize succeeded. */
  parameterManifest?: ParameterManifest;
};

/**
 * Dialect-parameterized NL→SQL generator. Validates inputs, builds the user/system
 * prompt with the dialect's syntax brief, calls the model, extracts the fenced SQL,
 * and runs the guardrails through the same decision point as `ask()`: the read-only
 * check (plus any dialect-specific `extraValidate`), and, when `deps.tenantPolicy` and
 * `deps.tenantScope` are supplied, the tenant check under the policy's `enforcement`.
 * Both check the returned `sql` and, when returned, `unboundNamedSql`. No sensitive check:
 * that needs a mode, which `ask()` takes.
 *
 * A `deny` throws the check's typed error (`SqlValidationError` before
 * `TenantGuardrailError`) with the verdict attached; otherwise the result carries
 * `verdict`. Tenant placeholders are left in place; `ask()` substitutes them.
 */
export async function generateSelectSql(
  dialect: DialectSpec,
  question: string,
  schema: AnyNormalizedSchema,
  model: AskDbLanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<GenerateSelectSqlResult> {
  const generated = await runGenerateSelectSql(dialect, question, schema, model, deps);
  const tenant =
    deps.tenantPolicy && deps.tenantScope ? { policy: deps.tenantPolicy, scope: deps.tenantScope } : undefined;
  const findings = evaluateGuardrails(
    {
      forms: {
        sql: generated.sql,
        ...(generated.unboundNamedSql !== undefined ? { template: generated.unboundNamedSql } : {}),
      },
      dialect,
      schema,
      ...(tenant ? { tenant } : {}),
    },
    tenant ? ["read-only", "tenant"] : ["read-only"],
  );
  const modes: GuardrailModes = { ...(tenant ? { tenant: tenant.policy.enforcement } : {}), sensitive: "off" };
  const verdict = decide(findings, modes, "return");
  logGuardrailVerdict(deps.logger, verdict, { tenantPolicy: tenant?.policy, sensitiveChecked: false });
  try {
    throwIfDenied(verdict, modes, "return");
  } catch (e) {
    logGenerateFailed(deps.logger, e);
    throw e;
  }
  const out: GenerateSelectSqlResult = { ...generated, verdict };
  if (tenant) out.tenantGuardrail = tenantGuardrailResult(findings);
  return out;
}

/**
 * Internal entry used by `ask()`: the model call and extraction only. `sql` is returned
 * even when it fails the read-only check, because `ask()` runs every guardrail itself,
 * through one decision point, before rendering. Not exported from the package index.
 */
export async function generateSelectSqlForAsk(
  dialect: DialectSpec,
  question: string,
  schema: AnyNormalizedSchema,
  model: AskDbLanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<Omit<GenerateSelectSqlResult, "verdict">> {
  return runGenerateSelectSql(dialect, question, schema, model, deps);
}

async function runGenerateSelectSql(
  dialect: DialectSpec,
  question: string,
  schema: AnyNormalizedSchema,
  model: AskDbLanguageModel,
  deps: GenerateSqlDeps,
): Promise<Omit<GenerateSelectSqlResult, "verdict">> {
  assertNlToSqlInputs(schema, question);
  const ambiguityNotes = nlToSqlAmbiguityNotes(question, schema);
  const generateText = deps.generateText ?? defaultGenerateText;
  const logger = deps.logger;
  const nlToSqlSchemaOptions: FormatNlToSqlOptions | undefined =
    deps.omitSensitiveIdentifiersFromNlToSqlPrompt === true
      ? { omitSensitiveIdentifiersFromPrompt: true }
      : undefined;
  const parameterize = deps.parameterize === true;

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
    let usage: GenerateSelectSqlResult["usage"];
    try {
      const result = await generateText({
        model,
        // `system` (not `instructions`) on purpose: `ai` is a peer dependency
        // (`^6 || ^7`). AI SDK 6 only reads `system`; AI SDK 7 renamed it to
        // `instructions` but still honors `system` as a deprecated alias
        // (`instructions = system` in its prompt standardization). Passing
        // `instructions` would be silently dropped on AI SDK 6.
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
          parameterize || undefined,
        ),
        temperature: 0,
        // Cast: AskDB's public `providerOptions` type is a plain opaque bag
        // (`Record<string, unknown>`) so callers don't need AI SDK JSON types.
        // We don't interpret or validate it — the AI SDK does that.
        ...(deps.providerOptions
          ? { providerOptions: deps.providerOptions as Parameters<typeof generateText>[0]["providerOptions"] }
          : {}),
        ...(deps.abortSignal ? { abortSignal: deps.abortSignal } : {}),
      });
      text = result.text;
      const u = (result as {
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      }).usage;
      if (u) {
        const fin = (v: number | undefined): number | null =>
          typeof v === "number" && isFinite(v) ? v : null;
        usage = {
          // AI SDK 6 calls these inputTokens/outputTokens; preserve the
          // legacy names for custom generators and older SDK versions.
          promptTokens: fin(u.promptTokens ?? u.inputTokens),
          completionTokens: fin(u.completionTokens ?? u.outputTokens),
          totalTokens: fin(u.totalTokens),
        };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SqlGenerationError(`Model call failed: ${message}`, e);
    }
    // The read-only check is a guardrail finding, decided by the caller; here the SQL is
    // only normalized (trailing `;` removed) when it passes.
    const sql = normalizeSelectSql(dialect, extractSqlFromModelText(text));

    // Optional parameterized extras — any failure clears them (never throws).
    let unboundNamedSql: string | undefined;
    let parameterManifest: ParameterManifest | undefined;
    if (parameterize) {
      const extras = tryParseParameterizedExtras(text, dialect, logger);
      unboundNamedSql = extras.unboundNamedSql;
      parameterManifest = extras.parameterManifest;
    }

    const explain = deps.explain ? buildSelectGuardrailExplanation(sql) : undefined;
    logger?.info(
      {
        event: AskDbLogEvent.PipelineGenerateComplete,
        sqlCharCount: sql.length,
      },
      "nl-to-sql generate complete",
    );
    const out: Omit<GenerateSelectSqlResult, "verdict"> = { sql };
    if (explain !== undefined) out.explain = explain;
    if (usage !== undefined) out.usage = usage;
    if (unboundNamedSql !== undefined) out.unboundNamedSql = unboundNamedSql;
    if (parameterManifest !== undefined) out.parameterManifest = parameterManifest;
    return out;
  } catch (e) {
    logGenerateFailed(logger, e);
    throw e;
  }
}

function logGenerateFailed(logger: AskDbLogger | undefined, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  logger?.error(
    {
      event: AskDbLogEvent.PipelineFailed,
      phase: "generate",
      errMessage: msg,
    },
    "nl-to-sql generate failed",
  );
}

/** `validateSelectSql`'s normalized SQL when it passes; the trimmed SQL when it doesn't. */
function normalizeSelectSql(dialect: DialectSpec, sql: string): string {
  try {
    return validateSelectSql(dialect, sql);
  } catch (e) {
    if (e instanceof SqlValidationError) return sql.trim();
    throw e;
  }
}

function tryParseParameterizedExtras(
  text: string,
  dialect: DialectSpec,
  logger: AskDbLogger | undefined,
): { unboundNamedSql?: string; parameterManifest?: ParameterManifest } {
  const unbound = extractUnboundSqlFromModelText(text);
  if (!unbound) {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PipelineParameterized,
        parameterCount: 0,
        listParameterCount: 0,
        reason: "missing_unbound",
      },
      "parameterize extras dropped",
    );
    return {};
  }

  let unboundValidated: string;
  try {
    unboundValidated = validateSelectSql(dialect, unbound);
  } catch {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PipelineParameterized,
        parameterCount: 0,
        listParameterCount: 0,
        reason: "unbound_invalid",
      },
      "parameterize extras dropped",
    );
    return {};
  }

  const parsed = parseParameterManifest(text);
  if (!parsed.ok) {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PipelineParameterized,
        parameterCount: 0,
        listParameterCount: 0,
        reason: parsed.reason.toLowerCase(),
      },
      "parameterize extras dropped",
    );
    return {};
  }

  const cross = crossValidateManifestAgainstSql(unboundValidated, parsed.manifest, dialect);
  if (!cross.ok) {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PipelineParameterized,
        parameterCount: 0,
        listParameterCount: 0,
        reason: cross.reason.toLowerCase(),
      },
      "parameterize extras dropped",
    );
    return {};
  }

  const listParameterCount = parsed.manifest.parameters.filter((p) => p.cardinality === "many").length;
  logger?.info(
    {
      event: AskDbLogEvent.PipelineParameterized,
      parameterCount: parsed.manifest.parameters.length,
      listParameterCount,
    },
    "parameterize extras accepted",
  );
  return { unboundNamedSql: unboundValidated, parameterManifest: parsed.manifest };
}

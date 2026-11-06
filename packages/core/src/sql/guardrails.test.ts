/**
 * The enforcement step (ADR 0010, decisions 2–4): each enforcement point hands
 * `enforceGuardrails()` its forms and context, and the step picks the checks and the point
 * from `path`, decides, logs and throws. The public functions' own tests cover each point
 * in depth; this table pins what the step owns across points: the point per path, the check
 * set per path, precedence on deny, logging, the derived results and the custom generator's
 * tenant findings.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SensitiveReferenceError,
  SqlValidationError,
  TenantGuardrailError,
  type GuardrailOutcome,
  type GuardrailVerdict,
} from "../errors.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { NormalizedSchemaV2 } from "../schema/v2/normalized.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import { POSTGRES_DIALECT } from "./dialect-spec.js";
import { enforceGuardrails, type EnforceInput, type Enforced } from "./guardrails.js";
import type { SensitiveGuardrailMode } from "./sensitive-guardrail.js";
import type { TenantGuardrailResult } from "./tenant-guardrail.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Policy `enforcement: strict`; `clients.email` and `clients.phone` are sensitive. */
const strictSchema = loadSchema(join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema"));
const warnSchema: NormalizedSchemaV2 = {
  ...strictSchema,
  tenantPolicy: { ...strictSchema.tenantPolicy!, enforcement: "warn" },
};
const { tenantPolicy: _policy, ...noPolicySchema } = strictSchema;
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["2"] } };

const scoped = "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids";
const unscoped = "SELECT count(*) FROM orders";
const readsEmail = "SELECT email FROM clients";
const unscopedReadsEmail = "SELECT o.id, c.email FROM orders o JOIN clients c ON c.id = o.client_id";

type Row = {
  name: string;
  path: EnforceInput["path"];
  schema: AnyNormalizedSchema;
  /** `sql` is ignored at rebind, which checks the template only. */
  forms: { sql: string; template?: string };
  /** `null`: a custom `AskDialect`, which has no `DialectSpec` (ask only). */
  dialect?: null;
  sensitiveGuardrailMode?: SensitiveGuardrailMode | "off";
  acceptWarnings?: ReadonlyArray<"tenant">;
  generatorTenantGuardrail?: TenantGuardrailResult;
  outcome: GuardrailOutcome;
  throws?: typeof SqlValidationError | typeof TenantGuardrailError | typeof SensitiveReferenceError;
  /** `check form rule`, one per finding, in verdict order. */
  findings: string[];
  logs: string[];
  /** The result's `tenantGuardrail`, by its `passed` field; absent when the result has none. */
  tenantPassed?: boolean;
  /** Whether the result carries `sensitiveGuardrail`; not checked when unset. */
  sensitiveGuardrail?: boolean;
};

const E = AskDbLogEvent;

const rows: Row[] = [
  // The point follows from the path: a tenant `warn` is returned by ask and generate, and
  // refused at rebind unless the caller accepts it.
  {
    name: "ask returns a tenant warn",
    path: "ask",
    schema: warnSchema,
    forms: { sql: unscoped },
    outcome: "warn",
    findings: ["tenant sql MISSING_TENANT_PREDICATE"],
    logs: [E.TenantGuardrailFailed],
    tenantPassed: false,
  },
  {
    name: "generate returns a tenant warn",
    path: "generate",
    schema: warnSchema,
    forms: { sql: unscoped },
    outcome: "warn",
    findings: ["tenant sql MISSING_TENANT_PREDICATE"],
    logs: [E.TenantGuardrailFailed],
    tenantPassed: false,
  },
  {
    name: "generate logs a tenant pass",
    path: "generate",
    schema: strictSchema,
    forms: { sql: scoped },
    outcome: "allow",
    findings: [],
    logs: [E.TenantGuardrailPassed],
    tenantPassed: true,
  },
  {
    name: "rebind refuses a tenant warn, and logs nothing",
    path: "rebind",
    schema: warnSchema,
    forms: { sql: "", template: unscoped },
    outcome: "deny",
    throws: TenantGuardrailError,
    findings: ["tenant template MISSING_TENANT_PREDICATE"],
    logs: [],
  },
  {
    name: "rebind binds a tenant warn the caller accepts, and logs nothing",
    path: "rebind",
    schema: warnSchema,
    forms: { sql: "", template: unscoped },
    acceptWarnings: ["tenant"],
    outcome: "warn",
    findings: ["tenant template MISSING_TENANT_PREDICATE"],
    logs: [],
    tenantPassed: false,
  },

  // The check set per path.
  {
    name: "ask checks sensitive references (default warn)",
    path: "ask",
    schema: noPolicySchema,
    forms: { sql: readsEmail },
    outcome: "warn",
    findings: ["sensitive sql SENSITIVE_COLUMN_REFERENCED"],
    logs: [E.PipelineSensitiveSqlWarning],
    sensitiveGuardrail: true,
  },
  {
    name: "ask skips the sensitive check under off",
    path: "ask",
    schema: noPolicySchema,
    forms: { sql: readsEmail },
    sensitiveGuardrailMode: "off",
    outcome: "allow",
    findings: [],
    logs: [],
    sensitiveGuardrail: false,
  },
  {
    name: "generate has no sensitive check",
    path: "generate",
    schema: noPolicySchema,
    forms: { sql: readsEmail },
    outcome: "allow",
    findings: [],
    logs: [],
    sensitiveGuardrail: false,
  },
  {
    name: "rebind checks sensitive references, and logs nothing",
    path: "rebind",
    schema: noPolicySchema,
    forms: { sql: "", template: readsEmail },
    outcome: "warn",
    findings: ["sensitive template SENSITIVE_COLUMN_REFERENCED"],
    logs: [],
    sensitiveGuardrail: true,
  },
  {
    name: "ask with a custom AskDialect has no read-only check",
    path: "ask",
    schema: noPolicySchema,
    forms: { sql: "DELETE FROM orders" },
    dialect: null,
    outcome: "allow",
    findings: [],
    logs: [],
  },
  {
    name: "ask checks every form it's given",
    path: "ask",
    schema: strictSchema,
    forms: { sql: scoped, template: unscoped },
    outcome: "deny",
    throws: TenantGuardrailError,
    findings: ["tenant template MISSING_TENANT_PREDICATE"],
    logs: [E.TenantGuardrailFailed, E.PipelineFailed],
  },

  // Precedence on deny: read-only, then tenant, then sensitive.
  {
    name: "tenant wins over sensitive",
    path: "ask",
    schema: strictSchema,
    forms: { sql: unscopedReadsEmail },
    sensitiveGuardrailMode: "strict",
    outcome: "deny",
    throws: TenantGuardrailError,
    findings: ["tenant sql MISSING_TENANT_PREDICATE", "sensitive sql SENSITIVE_COLUMN_REFERENCED"],
    logs: [E.TenantGuardrailFailed, E.PipelineSensitiveSqlWarning, E.PipelineFailed],
  },
  {
    name: "read-only wins over tenant",
    path: "generate",
    schema: strictSchema,
    forms: { sql: "DELETE FROM orders" },
    outcome: "deny",
    throws: SqlValidationError,
    findings: [
      "read-only sql SQL_NOT_SELECT_OR_WITH",
      "tenant sql NOT_SELECT_OR_WITH",
      "tenant sql MISSING_TENANT_PREDICATE",
    ],
    logs: [E.TenantGuardrailFailed, E.PipelineFailed],
  },
  {
    name: "read-only wins over sensitive at rebind",
    path: "rebind",
    schema: noPolicySchema,
    forms: { sql: "", template: "DELETE FROM clients WHERE email = 'x'" },
    sensitiveGuardrailMode: "strict",
    outcome: "deny",
    throws: SqlValidationError,
    findings: ["read-only template SQL_NOT_SELECT_OR_WITH", "sensitive template SENSITIVE_COLUMN_REFERENCED"],
    logs: [],
  },
  {
    name: "sensitive strict denies on its own",
    path: "ask",
    schema: noPolicySchema,
    forms: { sql: readsEmail },
    sensitiveGuardrailMode: "strict",
    outcome: "deny",
    throws: SensitiveReferenceError,
    findings: ["sensitive sql SENSITIVE_COLUMN_REFERENCED"],
    logs: [E.PipelineSensitiveSqlWarning, E.PipelineFailed],
  },

  // A custom generator's tenant result: decided with a tenant policy, passed through without one.
  {
    name: "a generator's failed tenant result with no details denies under a strict policy",
    path: "ask",
    schema: strictSchema,
    forms: { sql: scoped },
    generatorTenantGuardrail: { passed: false, warnings: [] },
    outcome: "deny",
    throws: TenantGuardrailError,
    findings: ["tenant generator UNPROVABLE_SCOPE"],
    logs: [E.TenantGuardrailFailed, E.PipelineFailed],
  },
  {
    name: "a generator's tenant result passes through without a policy",
    path: "ask",
    schema: noPolicySchema,
    forms: { sql: "SELECT count(*) FROM orders" },
    generatorTenantGuardrail: { passed: false, warnings: [] },
    outcome: "allow",
    findings: [],
    logs: [],
    tenantPassed: false,
  },
];

function inputFor(row: Row, logger: AskDbLogger): EnforceInput {
  const tenant =
    "schemaId" in row.schema && row.schema.tenantPolicy ? { policy: row.schema.tenantPolicy, scope } : undefined;
  const common = { schema: row.schema, ...(tenant ? { tenant } : {}) };
  const dialect = row.dialect === null ? undefined : POSTGRES_DIALECT;
  const forms = { sql: row.forms.sql, ...(row.forms.template !== undefined ? { template: row.forms.template } : {}) };
  switch (row.path) {
    case "ask":
      return {
        path: "ask",
        ...common,
        forms,
        dialect,
        sensitiveGuardrailMode: row.sensitiveGuardrailMode,
        generatorTenantGuardrail: row.generatorTenantGuardrail,
        logger,
      };
    case "generate":
      return { path: "generate", ...common, forms, dialect: POSTGRES_DIALECT, logger };
    case "rebind":
      // The rebind takes no logger. One is offered anyway, so the row pins that the step
      // never logs there.
      return {
        path: "rebind",
        ...common,
        forms: { template: row.forms.template! },
        dialect: POSTGRES_DIALECT,
        sensitiveGuardrailMode: row.sensitiveGuardrailMode,
        acceptWarnings: row.acceptWarnings,
        logger,
      } as EnforceInput;
  }
}

describe("enforceGuardrails", () => {
  it.each(rows)("$path: $name", (row) => {
    const events: string[] = [];
    const record = (context: Record<string, unknown>) => void events.push(context.event as string);
    const logger = { info: vi.fn(record), error: vi.fn(record) };

    let result: Enforced | undefined;
    let error: unknown;
    try {
      result = enforceGuardrails(inputFor(row, logger));
    } catch (e) {
      error = e;
    }

    let verdict: GuardrailVerdict;
    if (row.throws) {
      expect(error).toBeInstanceOf(row.throws);
      verdict = (error as { verdict: GuardrailVerdict }).verdict;
    } else {
      expect(error).toBeUndefined();
      verdict = result!.verdict;
      expect(result!.tenantGuardrail?.passed).toBe(row.tenantPassed);
      if (row.sensitiveGuardrail !== undefined) {
        expect(result!.sensitiveGuardrail !== undefined).toBe(row.sensitiveGuardrail);
      }
    }
    expect(verdict.outcome).toBe(row.outcome);
    expect(verdict.findings.map((f) => `${f.check} ${f.form} ${f.rule}`)).toEqual(row.findings);
    expect(events).toEqual(row.logs);
  });

  it("derives the tenant result from the verdict, once per warning across forms", () => {
    const { tenantGuardrail } = enforceGuardrails({
      path: "ask",
      forms: { sql: unscoped, template: unscoped },
      dialect: POSTGRES_DIALECT,
      schema: warnSchema,
      tenant: { policy: warnSchema.tenantPolicy!, scope },
    });
    expect(tenantGuardrail).toEqual({
      passed: false,
      warnings: [expect.objectContaining({ rule: "MISSING_TENANT_PREDICATE", tableId: "table:public.orders" })],
    });
  });
});

import {
  TenantGuardrailError,
  type TenantGuardrailWarning,
  type TenantGuardrailRuleCode,
} from "../errors.js";
import type {
  NormalizedTenantPolicy,
  TenantScope,
  ScopedTable,
  PolymorphicTable,
} from "../schema/v2/tenant-policy.js";

export type TenantGuardrailResult = {
  passed: boolean;
  warnings: TenantGuardrailWarning[];
};

/**
 * Validate generated SQL against the tenant policy and runtime scope.
 *
 * Uses heuristic pattern matching to verify that tenant-scoped tables
 * have the required predicates. Falls back to conservative rejection
 * when the SQL cannot be proven safe.
 *
 * In `strict` mode, throws `TenantGuardrailError` on failure.
 * In `warn` mode, returns warnings without throwing.
 */
export function validateTenantGuardrails(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
): TenantGuardrailResult {
  // Global scope bypasses tenant guardrails
  if (scope.access.kind === "global") {
    return { passed: true, warnings: [] };
  }

  const warnings: TenantGuardrailWarning[] = [];
  const normalizedSql = normalizeSql(sql);

  // Check scoped tables
  for (const st of policy.scopedTables) {
    const tableName = extractTableName(st.id);
    if (!mentionsTable(normalizedSql, tableName)) continue;
    checkScopedTable(normalizedSql, st, policy, warnings);
  }

  // Check polymorphic tables
  for (const pt of policy.polymorphicTables) {
    const tableName = extractTableName(pt.id);
    if (!mentionsTable(normalizedSql, tableName)) continue;
    checkPolymorphicTable(normalizedSql, pt, policy, warnings);
  }

  // Check unknown tables
  for (const entry of policy.coverage) {
    if (entry.classification !== "unknown") continue;
    const tableName = extractTableName(entry.tableId);
    if (mentionsTable(normalizedSql, tableName)) {
      warnings.push(
        warn("UNKNOWN_TABLE_REFERENCED", entry.tableId,
          `Query references unclassified table '${tableName}'. Classify it in tenant-policy.md.`),
      );
    }
  }

  const passed = warnings.length === 0;

  if (!passed && policy.enforcement === "strict") {
    throw new TenantGuardrailError(
      `Tenant guardrail validation failed (strict mode): ${warnings.map((w) => w.message).join("; ")}`,
      warnings,
    );
  }

  return { passed, warnings };
}

// ---------------------------------------------------------------------------
// Per-table checks
// ---------------------------------------------------------------------------

function checkScopedTable(
  sql: string,
  st: ScopedTable,
  policy: NormalizedTenantPolicy,
  warnings: TenantGuardrailWarning[],
): void {
  for (const path of st.scopeThrough) {
    if ("column" in path) {
      const colName = extractColumnName(path.column);
      const rootLabel = policy.roots.find((r) => r.id === path.root)?.label ?? path.root;
      const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;

      // Check if the tenant column or placeholder appears in the SQL
      if (mentionsIdentifier(sql, colName) || mentionsIdentifier(sql, placeholder)) {
        return; // At least one scope path is satisfied
      }
    } else {
      // Inherited via JOINs — check if the join path columns appear
      const allStepsPresent = path.join.every((step) => {
        const fromCol = extractColumnName(step.from);
        const toCol = extractColumnName(step.to);
        return mentionsIdentifier(sql, fromCol) && mentionsIdentifier(sql, toCol);
      });
      if (allStepsPresent) {
        // Also verify the root table's tenant column appears somewhere
        const rootTenantCol = policy.roots.find((r) => r.id === path.root);
        if (rootTenantCol) {
          const rootColName = extractColumnName(rootTenantCol.tenantIdColumn);
          const rootLabel = rootTenantCol.label;
          const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
          if (mentionsIdentifier(sql, rootColName) || mentionsIdentifier(sql, placeholder)) {
            return; // Join path + root filter present
          }
        }
      }
    }
  }

  // None of the scope paths were satisfied
  const pathDescriptions = st.scopeThrough.map((p) => {
    if ("column" in p) return extractColumnName(p.column);
    return p.join.map((j) => `${extractColumnName(j.from)}→${extractColumnName(j.to)}`).join(", ");
  });
  warnings.push(
    warn("MISSING_TENANT_PREDICATE", st.id,
      `Tenant-scoped table '${extractTableName(st.id)}' is missing required tenant predicate. ` +
      `Expected one of: ${pathDescriptions.join(" OR ")}`),
  );
}

function checkPolymorphicTable(
  sql: string,
  pt: PolymorphicTable,
  _policy: NormalizedTenantPolicy,
  warnings: TenantGuardrailWarning[],
): void {
  const typeColName = extractColumnName(pt.typeColumn);
  const idColName = extractColumnName(pt.idColumn);

  if (!mentionsIdentifier(sql, typeColName)) {
    warnings.push(
      warn("MISSING_TYPE_DISCRIMINATOR", pt.id,
        `Polymorphic table '${extractTableName(pt.id)}' is missing type discriminator column '${typeColName}' in WHERE clause.`),
    );
  }

  if (!mentionsIdentifier(sql, idColName)) {
    warnings.push(
      warn("MISSING_TENANT_PREDICATE", pt.id,
        `Polymorphic table '${extractTableName(pt.id)}' is missing id column '${idColName}' in WHERE/JOIN clause.`),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function warn(
  rule: TenantGuardrailRuleCode,
  tableId: string,
  message: string,
): TenantGuardrailWarning {
  return { rule, tableId, message };
}

function extractTableName(tableId: string): string {
  // "table:public.orders" → "orders"
  const dot = tableId.lastIndexOf(".");
  return dot !== -1 ? tableId.slice(dot + 1) : tableId;
}

function extractColumnName(columnId: string): string {
  // "table:public.orders#agency_id" → "agency_id"
  const hash = columnId.lastIndexOf("#");
  return hash !== -1 ? columnId.slice(hash + 1) : columnId;
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase();
}

function mentionsTable(normalizedSql: string, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function mentionsIdentifier(normalizedSql: string, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

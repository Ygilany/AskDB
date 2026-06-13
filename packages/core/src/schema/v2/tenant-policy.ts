import { z } from "zod";

// ---------------------------------------------------------------------------
// Front-matter zod schemas (validated when parsing tenant-policy.md)
// ---------------------------------------------------------------------------

const tenantRootParentSchema = z.strictObject({
  root: z.string().min(1),
  foreignKey: z.string().min(1),
});

export const tenantRootSchema = z.strictObject({
  id: z.string().min(1),
  tenantIdColumn: z.string().min(1),
  label: z.string().min(1),
  parent: tenantRootParentSchema.optional(),
});

export const hierarchyEdgeSchema = z.strictObject({
  parent: z.string().min(1),
  child: z.string().min(1),
  foreignKey: z.string().min(1),
});

const scopeThroughColumnSchema = z.strictObject({
  root: z.string().min(1),
  column: z.string().min(1),
});

const joinStepSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
});

const scopeThroughJoinSchema = z.strictObject({
  root: z.string().min(1),
  join: z.array(joinStepSchema).min(1),
});

const scopeThroughSchema = z.union([scopeThroughColumnSchema, scopeThroughJoinSchema]);

export const scopedTableSchema = z.strictObject({
  id: z.string().min(1),
  scopeThrough: z.array(scopeThroughSchema).min(1),
});

export const polymorphicTableSchema = z.strictObject({
  id: z.string().min(1),
  typeColumn: z.string().min(1),
  idColumn: z.string().min(1),
  mapping: z.record(z.string(), z.string().min(1)),
});

export const enforcementModeSchema = z.enum(["strict", "warn"]);

export const tenantPolicyFrontmatterSchema = z.strictObject({
  schemaId: z.string().min(1),
  enforcement: enforcementModeSchema,
  roots: z.array(tenantRootSchema).min(1),
  hierarchy: z.array(hierarchyEdgeSchema).optional(),
  scopedTables: z.array(scopedTableSchema).optional(),
  polymorphicTables: z.array(polymorphicTableSchema).optional(),
  globalTables: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Inferred types from zod schemas
// ---------------------------------------------------------------------------

export type TenantRoot = z.infer<typeof tenantRootSchema>;
export type HierarchyEdge = z.infer<typeof hierarchyEdgeSchema>;
export type ScopeThrough = z.infer<typeof scopeThroughSchema>;
export type ScopedTable = z.infer<typeof scopedTableSchema>;
export type PolymorphicTable = z.infer<typeof polymorphicTableSchema>;
export type EnforcementMode = z.infer<typeof enforcementModeSchema>;
export type TenantPolicyFrontmatter = z.infer<typeof tenantPolicyFrontmatterSchema>;

// ---------------------------------------------------------------------------
// Recognized H2 sections in tenant-policy.md body
// ---------------------------------------------------------------------------

export const TENANT_POLICY_H2_SECTIONS = [
  "Hierarchy",
  "Scope rules",
  "Sensitive interactions",
] as const;

export type TenantPolicyH2Section = (typeof TENANT_POLICY_H2_SECTIONS)[number];

// ---------------------------------------------------------------------------
// Parsed representation (front-matter + body)
// ---------------------------------------------------------------------------

export type ParsedTenantPolicyMarkdown = {
  frontmatter: TenantPolicyFrontmatter;
  body: string;
  sections: Partial<Record<TenantPolicyH2Section, string>>;
};

// ---------------------------------------------------------------------------
// Runtime scope types (passed to ask())
// ---------------------------------------------------------------------------

export type TenantAccessIds = {
  kind: "ids";
  tenantRoot: string;
  ids: string[];
};

export type TenantAccessSubtree = {
  kind: "subtree";
  tenantRoot: string;
  rootIds: string[];
  includeDescendants: true;
};

export type TenantAccessMultiRoot = {
  kind: "multi_root";
  scopes: Array<{
    tenantRoot: string;
    ids: string[];
  }>;
};

export type TenantAccessGlobal = {
  kind: "global";
  reason: string;
};

export type TenantAccess =
  | TenantAccessIds
  | TenantAccessSubtree
  | TenantAccessMultiRoot
  | TenantAccessGlobal;

export type TenantFilterCondition = {
  column: string;
  operator: "=" | "IN" | "!=" | "NOT IN";
  value: string | string[];
};

export type TenantFilter = {
  conditions: TenantFilterCondition[];
};

export type TenantScopeContext = {
  role?: string;
  label?: string;
  department?: string;
  region?: string;
  attributes?: Record<string, string>;
  description?: string;
};

export type TenantScope = {
  access: TenantAccess;
  tenantFilters?: Record<string, TenantFilter>;
  context?: TenantScopeContext;
};

// ---------------------------------------------------------------------------
// Zod schemas for runtime scope validation
// ---------------------------------------------------------------------------

const tenantAccessIdsSchema = z.object({
  kind: z.literal("ids"),
  tenantRoot: z.string().min(1),
  ids: z.array(z.string()).min(1),
});

const tenantAccessSubtreeSchema = z.object({
  kind: z.literal("subtree"),
  tenantRoot: z.string().min(1),
  rootIds: z.array(z.string()).min(1),
  includeDescendants: z.literal(true),
});

const tenantAccessMultiRootSchema = z.object({
  kind: z.literal("multi_root"),
  scopes: z
    .array(
      z.object({
        tenantRoot: z.string().min(1),
        ids: z.array(z.string()).min(1),
      }),
    )
    .min(1),
});

const tenantAccessGlobalSchema = z.object({
  kind: z.literal("global"),
  reason: z.string().min(1),
});

export const tenantAccessSchema = z.discriminatedUnion("kind", [
  tenantAccessIdsSchema,
  tenantAccessSubtreeSchema,
  tenantAccessMultiRootSchema,
  tenantAccessGlobalSchema,
]);

const tenantFilterConditionSchema = z.object({
  column: z.string().min(1),
  operator: z.enum(["=", "IN", "!=", "NOT IN"]),
  value: z.union([z.string(), z.array(z.string())]),
});

const tenantFilterSchema = z.object({
  conditions: z.array(tenantFilterConditionSchema).min(1),
});

const tenantScopeContextSchema = z.strictObject({
  role: z.string().optional(),
  label: z.string().optional(),
  department: z.string().optional(),
  region: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
});

export const tenantScopeSchema = z.object({
  access: tenantAccessSchema,
  tenantFilters: z.record(z.string(), tenantFilterSchema).optional(),
  context: tenantScopeContextSchema.optional(),
});

// ---------------------------------------------------------------------------
// Normalized tenant policy (after cross-reference validation)
// ---------------------------------------------------------------------------

export type TableTenantClassification =
  | "scoped"
  | "inherited"
  | "polymorphic"
  | "global"
  | "root"
  | "unknown";

export type TableCoverageEntry = {
  tableId: string;
  classification: TableTenantClassification;
  scopeRoots?: string[];
};

export type TenantPolicyWarning =
  | { kind: "orphaned_root_id"; id: string }
  | { kind: "orphaned_column_id"; id: string; context: string }
  | { kind: "orphaned_scoped_table_id"; id: string }
  | { kind: "orphaned_polymorphic_table_id"; id: string }
  | { kind: "orphaned_global_table_id"; id: string }
  | { kind: "orphaned_fk_id"; id: string; context: string }
  | { kind: "hierarchy_cycle"; ids: string[] }
  | { kind: "unknown_root_in_scope"; id: string; context: string }
  | { kind: "unknown_root_in_hierarchy"; id: string; context: string }
  | { kind: "unknown_root_in_mapping"; id: string; context: string };

export type NormalizedTenantPolicy = {
  schemaId: string;
  enforcement: EnforcementMode;
  roots: TenantRoot[];
  hierarchy: HierarchyEdge[];
  scopedTables: ScopedTable[];
  polymorphicTables: PolymorphicTable[];
  globalTables: string[];
  coverage: TableCoverageEntry[];
  warnings: TenantPolicyWarning[];
  body: string;
  sections: Partial<Record<TenantPolicyH2Section, string>>;
};

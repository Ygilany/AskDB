import { z } from "zod";
import type { QueryParameterRejectionReason } from "../errors.js";
import {
  isValidListContext,
  scanPlaceholders,
  type QueryParameterType,
  type QueryParameterValue,
} from "./bind.js";
import type { DialectSpec } from "./dialect-spec.js";

export type ManifestParameter = {
  name: string;
  type: QueryParameterType;
  cardinality: "one" | "many";
  description?: string;
  value: QueryParameterValue | QueryParameterValue[];
};

export type ParameterManifest = {
  parameters: ManifestParameter[];
};

export type ManifestParseFailure = {
  ok: false;
  reason: QueryParameterRejectionReason | "MALFORMED" | "EMPTY" | "MISSING";
  message: string;
};

export type ManifestParseSuccess = {
  ok: true;
  manifest: ParameterManifest;
};

export type ManifestParseResult = ManifestParseSuccess | ManifestParseFailure;

const NAME_RE = /^[a-z][a-z0-9_]*$/;

const scalarValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const parameterSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "date", "datetime"]),
  cardinality: z.enum(["one", "many"]),
  description: z.string().optional(),
  value: z.unknown(),
});

const manifestSchema = z.object({
  parameters: z.array(parameterSchema),
});

function failure(
  reason: ManifestParseFailure["reason"],
  message: string,
): ManifestParseFailure {
  return { ok: false, reason, message };
}

function validateValue(
  type: QueryParameterType,
  cardinality: "one" | "many",
  value: unknown,
): ManifestParseFailure | { ok: true; value: QueryParameterValue | QueryParameterValue[] } {
  if (value === null || value === undefined) {
    return failure("INVALID_VALUE", "Parameter value must not be null or undefined.");
  }
  if (cardinality === "many") {
    if (!Array.isArray(value) || value.length === 0) {
      return failure("INVALID_VALUE", "List parameter requires a non-empty array value.");
    }
    const items: QueryParameterValue[] = [];
    for (const item of value) {
      const one = validateScalar(type, item);
      if (!one.ok) return one;
      items.push(one.value);
    }
    return { ok: true, value: items };
  }
  if (Array.isArray(value)) {
    return failure("INVALID_VALUE", "Scalar parameter must not be an array.");
  }
  return validateScalar(type, value);
}

function validateScalar(
  type: QueryParameterType,
  value: unknown,
): ManifestParseFailure | { ok: true; value: QueryParameterValue } {
  if (typeof value === "object" && value !== null) {
    return failure("INVALID_VALUE", "Parameter value must be a string, number, or boolean.");
  }
  switch (type) {
    case "string":
      if (typeof value !== "string") {
        return failure("INVALID_VALUE", "Parameter of type string requires a string value.");
      }
      return { ok: true, value };
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return failure("INVALID_VALUE", "Date parameter must be an ISO date string (YYYY-MM-DD).");
      }
      return { ok: true, value };
    case "datetime":
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)
      ) {
        return failure("INVALID_VALUE", "Datetime parameter must be an ISO datetime string.");
      }
      return { ok: true, value };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return failure("INVALID_VALUE", "Numeric parameter must be a finite number.");
      }
      return { ok: true, value };
    case "boolean":
      if (typeof value !== "boolean") {
        return failure("INVALID_VALUE", "Boolean parameter requires a boolean value.");
      }
      return { ok: true, value };
  }
}

/**
 * Extract and validate the ```json parameter manifest fence from model text.
 * Returns a typed failure the caller can act on — never throws.
 */
export function parseParameterManifest(modelText: string): ManifestParseResult {
  const fence = /```json\s*([\s\S]*?)```/im.exec(modelText.trim());
  if (!fence?.[1]) {
    return failure("MISSING", "No ```json parameter manifest fence found.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence[1].trim());
  } catch {
    return failure("MALFORMED", "Parameter manifest JSON is malformed.");
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    return failure("MALFORMED", "Parameter manifest does not match the expected shape.");
  }

  if (result.data.parameters.length === 0) {
    return failure("EMPTY", "Parameter manifest has an empty parameters array.");
  }

  const parameters: ManifestParameter[] = [];
  for (const p of result.data.parameters) {
    if (!NAME_RE.test(p.name)) {
      return failure("INVALID_NAME", "Parameter name must match ^[a-z][a-z0-9_]*$.");
    }
    if (p.name.startsWith("tenant_") || p.name.startsWith("askdb_")) {
      return failure("RESERVED_NAME", "Parameter name uses a reserved prefix.");
    }
    const valueCheck = validateValue(p.type, p.cardinality, p.value);
    if (!valueCheck.ok) return valueCheck;
    // Reject mixed-type arrays already handled by per-item type checks.
    void scalarValueSchema; // keep import used for documentation of accepted scalars
    parameters.push({
      name: p.name,
      type: p.type,
      cardinality: p.cardinality,
      description: p.description,
      value: valueCheck.value,
    });
  }

  return { ok: true, manifest: { parameters } };
}

/**
 * Cross-validate a parsed manifest against unbound SQL.
 * Returns a typed failure — never throws.
 */
export function crossValidateManifestAgainstSql(
  unboundSql: string,
  manifest: ParameterManifest,
  dialect: Pick<DialectSpec, "listBinding">,
): ManifestParseResult {
  const listBinding = dialect.listBinding ?? "expand";
  const occurrences = scanPlaceholders(unboundSql);
  const nonTenant = occurrences.filter((o) => !o.name.startsWith("tenant_"));
  const byName = new Map(manifest.parameters.map((p) => [p.name, p]));

  for (const p of manifest.parameters) {
    if (!nonTenant.some((o) => o.name === p.name) && !occurrences.some((o) => o.name === p.name)) {
      return failure("UNRESOLVED_PLACEHOLDER", "Manifest parameter does not appear in unbound SQL.");
    }
    // Tenant placeholders must not appear in the manifest (already rejected by RESERVED_NAME
    // for tenant_ prefix). Double-check appearance of tenant_* in unbound is OK without manifest entry.
  }

  for (const occ of nonTenant) {
    if (!byName.has(occ.name)) {
      return failure(
        "UNRESOLVED_PLACEHOLDER",
        "Unbound SQL contains a non-tenant placeholder absent from the manifest.",
      );
    }
  }

  for (const occ of occurrences) {
    const p = byName.get(occ.name);
    if (!p) continue; // tenant placeholders have no manifest entry
    if (p.cardinality === "many" && !isValidListContext(unboundSql, occ, listBinding)) {
      return failure(
        "INVALID_LIST_CONTEXT",
        "List parameter is not in a valid IN (...) or = ANY(...) context.",
      );
    }
  }

  return { ok: true, manifest };
}

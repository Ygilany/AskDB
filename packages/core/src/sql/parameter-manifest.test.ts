import { describe, expect, it } from "vitest";
import {
  crossValidateManifestAgainstSql,
  parseParameterManifest,
} from "./parameter-manifest.js";

const validReply = `
\`\`\`sql
SELECT count(*) FROM cities WHERE state = 'colorado'
\`\`\`
\`\`\`sql-unbound
SELECT count(*) FROM cities WHERE state = :state_name
\`\`\`
\`\`\`json
{"parameters":[{"name":"state_name","type":"string","cardinality":"one","description":"State to count cities for","value":"colorado"}]}
\`\`\`
`;

describe("parseParameterManifest", () => {
  it("parses a valid manifest", () => {
    const result = parseParameterManifest(validReply);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.parameters).toHaveLength(1);
      expect(result.manifest.parameters[0]!.name).toBe("state_name");
      expect(result.manifest.parameters[0]!.value).toBe("colorado");
    }
  });

  it("rejects malformed JSON", () => {
    const result = parseParameterManifest("```json\n{not json}\n```");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MALFORMED");
  });

  it("treats an empty parameters array as no parameters", () => {
    const result = parseParameterManifest('```json\n{"parameters":[]}\n```');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EMPTY");
  });

  it("rejects reserved tenant_ names", () => {
    const result = parseParameterManifest(
      '```json\n{"parameters":[{"name":"tenant_agency_ids","type":"string","cardinality":"one","value":"1"}]}\n```',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("RESERVED_NAME");
  });

  it("rejects invalid names", () => {
    const result = parseParameterManifest(
      '```json\n{"parameters":[{"name":"1bad","type":"string","cardinality":"one","value":"x"}]}\n```',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_NAME");
  });

  it("rejects array value for cardinality one", () => {
    const result = parseParameterManifest(
      '```json\n{"parameters":[{"name":"s","type":"string","cardinality":"one","value":["a"]}]}\n```',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_VALUE");
  });

  it("rejects empty array for cardinality many", () => {
    const result = parseParameterManifest(
      '```json\n{"parameters":[{"name":"s","type":"string","cardinality":"many","value":[]}]}\n```',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_VALUE");
  });

  it("returns MISSING when no json fence", () => {
    const result = parseParameterManifest("```sql\nSELECT 1\n```");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING");
  });
});

describe("crossValidateManifestAgainstSql", () => {
  it("accepts a consistent unbound SQL + manifest", () => {
    const parsed = parseParameterManifest(validReply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cross = crossValidateManifestAgainstSql(
      "SELECT count(*) FROM cities WHERE state = :state_name",
      parsed.manifest,
      { listBinding: "array" },
    );
    expect(cross.ok).toBe(true);
  });

  it("rejects when unbound SQL has an undeclared non-tenant placeholder", () => {
    const parsed = parseParameterManifest(validReply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cross = crossValidateManifestAgainstSql(
      "SELECT count(*) FROM cities WHERE state = :state_name AND x = :extra",
      parsed.manifest,
      { listBinding: "expand" },
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reason).toBe("UNRESOLVED_PLACEHOLDER");
  });

  it("allows tenant placeholders in unbound SQL without manifest entries", () => {
    const parsed = parseParameterManifest(validReply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cross = crossValidateManifestAgainstSql(
      "SELECT count(*) FROM cities WHERE state = :state_name AND agency_id = :tenant_agency_ids",
      parsed.manifest,
      { listBinding: "array" },
    );
    expect(cross.ok).toBe(true);
  });

  it("rejects list params outside list context", () => {
    const reply = `\`\`\`json
{"parameters":[{"name":"ids","type":"string","cardinality":"many","value":["a","b"]}]}
\`\`\``;
    const parsed = parseParameterManifest(reply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cross = crossValidateManifestAgainstSql(
      "SELECT * FROM t WHERE id = :ids",
      parsed.manifest,
      { listBinding: "expand" },
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reason).toBe("INVALID_LIST_CONTEXT");
  });
});

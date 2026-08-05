import { describe, expect, it } from "vitest";
import { extractSqlFromModelText, extractUnboundSqlFromModelText } from "./extract-sql.js";

const threeBlockReply = `
Here is the answer:
\`\`\`sql
SELECT count(*) FROM cities WHERE state = 'colorado'
\`\`\`
\`\`\`sql-unbound
SELECT count(*) FROM cities WHERE state = :state_name
\`\`\`
\`\`\`json
{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}
\`\`\`
`;

const threeBlockJsonFirst = `
\`\`\`json
{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}
\`\`\`
\`\`\`sql-unbound
SELECT count(*) FROM cities WHERE state = :state_name
\`\`\`
\`\`\`sql
SELECT count(*) FROM cities WHERE state = 'colorado'
\`\`\`
`;

describe("extractSqlFromModelText", () => {
  it("prefers an explicitly sql-tagged fence among sql / sql-unbound / json", () => {
    expect(extractSqlFromModelText(threeBlockReply)).toBe(
      "SELECT count(*) FROM cities WHERE state = 'colorado'",
    );
    expect(extractSqlFromModelText(threeBlockJsonFirst)).toBe(
      "SELECT count(*) FROM cities WHERE state = 'colorado'",
    );
  });

  it("returns contents of an untagged fence", () => {
    expect(extractSqlFromModelText("```\nSELECT 1\n```")).toBe("SELECT 1");
  });

  it("returns no SQL when only a json fence is present", () => {
    const onlyJson = '```json\n{"parameters":[]}\n```';
    expect(extractSqlFromModelText(onlyJson)).toBe("");
  });

  it("returns bare prose when no fence is present", () => {
    expect(extractSqlFromModelText("SELECT id FROM users")).toBe("SELECT id FROM users");
  });
});

describe("extractUnboundSqlFromModelText", () => {
  it("extracts the sql-unbound fence regardless of block order", () => {
    expect(extractUnboundSqlFromModelText(threeBlockReply)).toBe(
      "SELECT count(*) FROM cities WHERE state = :state_name",
    );
    expect(extractUnboundSqlFromModelText(threeBlockJsonFirst)).toBe(
      "SELECT count(*) FROM cities WHERE state = :state_name",
    );
  });

  it("returns undefined when no sql-unbound fence is present", () => {
    expect(extractUnboundSqlFromModelText("```sql\nSELECT 1\n```")).toBeUndefined();
    expect(extractUnboundSqlFromModelText('```json\n{"parameters":[]}\n```')).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { createMentionMatcher, findMentionedNames, sensitiveMentionNames, type MentionName } from "./mentions.js";
import type { NormalizedSchemaV2, NormalizedV2Column } from "./normalized.js";

const orgId = { table: "users", column: "org_id" };

describe("findMentionedNames", () => {
  it.each<[string, MentionName, boolean]>([
    ["filter by email", "email", true],
    ["Filter by EMAIL", "email", true],
    ["filter by `email`", "email", true],
    ['the "email" column', "email", true],
    ["users.email", "email", true],
    ["email,phone", "phone", true],
    ["we emailed them", "email", false],
    ["the user_email column", "email", false],
    ["email2 is unused", "email", false],
    ["store the ssn$ hash", "ssn$", true],
    ["store the ssn$x hash", "ssn$", false],
    ["Café opening hours", "café", true],
    ["CAFÉ opening hours", "café", true],
    ["the cafés nearby", "café", false],
    ["the xcafé nearby", "café", false],
    ["Open the café", "caf", false],
    // A bare name is literal, dots included.
    ["the a.b column", "a.b", true],
    ["the a . b column", "a.b", false],
    // A qualified name.
    ["read users.org_id", orgId, true],
    ["read public.users.org_id", orgId, true],
    ['read "users"."org_id"', orgId, true],
    ["read [users].[org_id]", orgId, true],
    ["read `users`.`org_id`", orgId, true],
    ["read users . org_id", orgId, true],
    ["read users\t.\torg_id", orgId, true],
    ["ends with users.org_id.", orgId, true],
    ["Rows come from users. Org_id is the key", orgId, false],
    ["read users\n.\norg_id", orgId, false],
    ["read users .org_id", orgId, false],
    ['read "users].[org_id"', orgId, false],
    ["read app_users.org_id", orgId, false],
    ["read users.org_id_v2", orgId, false],
    ["read org_id", orgId, false],
  ])("%j mentions %j: %s", (text, name, expected) => {
    expect(findMentionedNames(text, [name])).toEqual(expected ? [name] : []);
  });

  it("returns every mentioned name, in the order given", () => {
    expect(findMentionedNames("phone or email", ["email", "ssn", "phone"])).toEqual(["email", "phone"]);
  });
});

describe("createMentionMatcher", () => {
  it("answers mentionsAny the same way find does", () => {
    // Two columns of one table, one a prefix of the other, and the same column under another table.
    const org = { table: "users", column: "org" };
    const matcher = createMentionMatcher(["email", orgId, org, { table: "accounts", column: "org_id" }]);
    for (const text of [
      "filter by email",
      "read users.org_id",
      "read users.org",
      "read users.orgx",
      'read "users" . [org]',
      "read accounts.org_id",
      "read org_id",
      "users. Org_id",
      "",
    ]) {
      expect(matcher.mentionsAny(text)).toBe(matcher.find(text).length > 0);
    }
  });

  it("checks many texts against every column of many sensitive tables quickly", () => {
    // 30 sensitive tables of 30 columns each, as `{ table, column }` names; 90,000 texts that name none.
    const names = Array.from({ length: 900 }, (_, i) => ({ table: `t${Math.floor(i / 30)}`, column: `col_${i % 30}` }));
    const matcher = createMentionMatcher(names);
    const started = performance.now();
    let hits = 0;
    for (let i = 0; i < 90_000; i++) if (matcher.mentionsAny(`the t${i % 30} order total for region ${i}`)) hits++;
    expect(hits).toBe(0);
    // One alternative per name took about 1.8 s here; grouping them by table takes about 50 ms.
    expect(performance.now() - started).toBeLessThan(750);
  });

  it("mentions nothing for an empty list or empty names", () => {
    expect(createMentionMatcher([]).mentionsAny("anything, at all")).toBe(false);
    expect(createMentionMatcher([""]).mentionsAny("anything, at all")).toBe(false);
    expect(createMentionMatcher([{ table: "", column: "x" }]).mentionsAny("read .x, at all")).toBe(false);
  });
});

describe("sensitiveMentionNames", () => {
  const col = (name: string, sensitive: boolean, extra: Partial<NormalizedV2Column> = {}): NormalizedV2Column => ({
    id: `col:${name}`,
    name,
    type: "text",
    nullable: true,
    primaryKey: false,
    sensitive,
    ...extra,
  });

  it("lists marked columns bare and table-inherited columns qualified, across the whole schema (ADR 0017)", () => {
    const schema: NormalizedSchemaV2 = {
      schemaId: "s",
      warnings: [],
      tables: [
        { id: "t:customers", name: "customers", schema: "public", sensitive: false, columns: [col("id", false), col("email", true)] },
        {
          id: "t:users",
          name: "users",
          schema: "public",
          sensitive: true,
          columns: [
            col("org_id", true, { sensitiveFromTable: true }),
            // Marked itself as well as through its table: bare.
            col("email", true),
            // Normalized without the provenance field: the conservative, bare reading.
            col("ssn", true),
          ],
        },
        { id: "t:audit", name: "audit", schema: "public", sensitive: false, tracked: false, columns: [col("api_key", true)] },
      ],
    };
    expect(sensitiveMentionNames(schema)).toEqual(["email", { table: "users", column: "org_id" }, "ssn", "api_key"]);
  });
});

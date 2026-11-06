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

  it("costs about the same for 30 sensitive tables whether each has 1 column or 30", () => {
    // 30 tables of `{ table, column }` names; texts that name none. The cost must follow the number
    // of tables, not of columns. One alternative per name made 900 names about 700 times slower than
    // 30 (over 3,000 times on Node 22); grouping by table without the first pass, about 4 to 18 times.
    const names = (columns: number) =>
      Array.from({ length: 30 * columns }, (_, i) => ({ table: `t${i % 30}`, column: `col_${Math.floor(i / 30)}` }));
    const texts = Array.from({ length: 30 }, (_, i) => `the t${i} order total for region ${i}`);
    type Matcher = ReturnType<typeof createMentionMatcher>;
    // One sample: the cost per text of passes over `texts` that last at least 2 ms.
    const costPerText = (matcher: Matcher) => {
      let checked = 0;
      let elapsed = 0;
      const started = performance.now();
      do {
        for (const text of texts) if (matcher.mentionsAny(text)) throw new Error(`unexpected mention in ${text}`);
        checked += texts.length;
        elapsed = performance.now() - started;
      } while (elapsed < 2);
      return elapsed / checked;
    };
    // A loaded runner stalls some samples. Many short samples, in rounds that alternate which
    // matcher goes first, keep a stall from landing on one matcher only, and each one's fastest
    // sample is one that no stall touched (#657).
    const oneColumnEach = createMentionMatcher(names(1));
    const thirtyColumnsEach = createMentionMatcher(names(30));
    let fastestOne = Number.POSITIVE_INFINITY;
    let fastestThirty = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 31; round++) {
      if (round % 2 === 0) {
        fastestOne = Math.min(fastestOne, costPerText(oneColumnEach));
        fastestThirty = Math.min(fastestThirty, costPerText(thirtyColumnsEach));
      } else {
        fastestThirty = Math.min(fastestThirty, costPerText(thirtyColumnsEach));
        fastestOne = Math.min(fastestOne, costPerText(oneColumnEach));
      }
    }
    expect(fastestThirty / fastestOne).toBeLessThan(2);
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

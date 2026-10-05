import { describe, expect, it } from "vitest";
import { createMentionMatcher, findMentionedNames, type MentionName } from "./mentions.js";

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
    const matcher = createMentionMatcher(["email", orgId]);
    for (const text of ["filter by email", "read users.org_id", "read org_id", "users. Org_id", ""]) {
      expect(matcher.mentionsAny(text)).toBe(matcher.find(text).length > 0);
    }
  });

  it("mentions nothing for an empty list or empty names", () => {
    expect(createMentionMatcher([]).mentionsAny("anything")).toBe(false);
    expect(createMentionMatcher(["", { table: "", column: "x" }]).mentionsAny("x")).toBe(false);
  });
});

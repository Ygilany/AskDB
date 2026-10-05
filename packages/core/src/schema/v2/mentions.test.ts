import { describe, expect, it } from "vitest";
import { findMentionedNames } from "./mentions.js";

describe("findMentionedNames", () => {
  it.each<[string, string, boolean]>([
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
    ["read users.org_id", "users.org_id", true],
    ["read public.users.org_id", "users.org_id", true],
    ['read "users"."org_id"', "users.org_id", true],
    ["read [users].[org_id]", "users.org_id", true],
    ["read `users`.`org_id`", "users.org_id", true],
    ["read users . org_id", "users.org_id", true],
    ["read app_users.org_id", "users.org_id", false],
    ["read users.org_id_v2", "users.org_id", false],
    ["read org_id", "users.org_id", false],
  ])("%j mentions %j: %s", (text, name, expected) => {
    expect(findMentionedNames(text, [name])).toEqual(expected ? [name] : []);
  });

  it("returns every mentioned name, in the order given", () => {
    expect(findMentionedNames("phone or email", ["email", "ssn", "phone"])).toEqual(["email", "phone"]);
  });
});

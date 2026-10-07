/**
 * `pageToken`: the lab reads Studio's session token from its page however the `<meta>` tag
 * is written.
 *
 * Protects: the `studio-request-guard` capability probe and every Studio protection test.
 * Both find the token through `pageToken`. HTML attributes are unordered, so Studio's
 * browser client finds the token whatever the attribute order or quoting.
 * Catches: a behavior-preserving markup change in Studio (attributes swapped, single
 * quotes, extra attributes) that makes the probe report the guard missing, so a release
 * that has it reports `n/a (capability: studio-request-guard)` and the suite never tests it.
 * Not covered elsewhere: `test/surfaces/studio.test.ts` runs against whatever markup the
 * installed Studio emits today, so it can't see the probe misread other valid markup.
 * No production seam: `pageToken` is lab code, called with page text.
 */
import { describe, expect, it } from "vitest";
import { pageToken } from "../src/studio.js";

const TOKEN = "a".repeat(64);

describe("pageToken", () => {
  it.each([
    ["name first", `<meta name="askdb-studio-token" content="${TOKEN}">`],
    ["content first", `<meta content="${TOKEN}" name="askdb-studio-token">`],
    ["single quotes", `<meta content='${TOKEN}' name='askdb-studio-token' />`],
    ["other attributes and upper case", `<META data-x="1" CONTENT="${TOKEN}" charset=utf-8 NAME="askdb-studio-token">`],
    ["after another meta tag", `<meta name="viewport" content="width=device-width"><meta name="askdb-studio-token" content="${TOKEN}">`],
  ])("finds the token with %s", (_label, html) => {
    expect(pageToken(`<html><head>${html}</head></html>`)).toBe(TOKEN);
  });

  it.each([
    ["no token tag", `<meta name="viewport" content="${TOKEN}">`],
    ["a token tag with no content", `<meta name="askdb-studio-token">`],
    ["the name only inside another attribute", `<meta content="${TOKEN}" data-name="askdb-studio-token">`],
  ])("finds nothing with %s", (_label, html) => {
    expect(pageToken(`<html><head>${html}</head></html>`)).toBeUndefined();
  });
});

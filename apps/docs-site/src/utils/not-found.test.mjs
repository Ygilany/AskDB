import assert from "node:assert/strict";
import { test } from "node:test";
import { notFoundJson, notFoundMarkdown } from "./not-found.mjs";

test("the Markdown not-found body links the docs, llms.txt and the sitemap by absolute URL", () => {
  const markdown = notFoundMarkdown("https://askdb.tools/");
  for (const path of ["", "llms.txt", "sitemap-index.xml"]) assert.ok(markdown.includes(`](https://askdb.tools/${path})`));
  assert.doesNotMatch(markdown, /\]\(\//);
});

test("a backtick or line break in the path can't leave its code span", () => {
  assert.match(notFoundMarkdown("https://askdb.tools/", "/a`b\n# c"), /`\/ab# c`/);
});

test("the JSON not-found body uses askdb-http's error shape, with a hint and absolute links", () => {
  const body = notFoundJson("https://askdb.tools/", "/nope");
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.message, "There is no page at /nope.");
  assert.ok(body.error.hint.length > 20);
  assert.equal(body.error.openapi, "https://askdb.tools/openapi.json");
});

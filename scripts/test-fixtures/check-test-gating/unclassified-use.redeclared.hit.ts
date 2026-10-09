import * as v from "vitest";
var t = null;
var { test: t } = v;
t.skipIf(!process.env.DATABASE_URL)("redeclared through a destructuring", () => {}); // HIT
function withParam(it) {
  var it = v.it; // HIT
  it.skipIf(!process.env.DATABASE_URL)("redeclared over a parameter", () => {}); // HIT
}
var mixedTest = it.extend({});
var mixedTest = test.extend({});
mixedTest("declarations that disagree on the function", () => {}); // HIT
var mixedKind = test.extend({});
var mixedKind = await import("vitest");
mixedKind("declarations that disagree on the kind", () => {}); // HIT

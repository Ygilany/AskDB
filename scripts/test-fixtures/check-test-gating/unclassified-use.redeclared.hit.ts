import * as v from "vitest";
var t = null;
var { test: t } = v;
t.skipIf(!process.env.DATABASE_URL)("redeclared through a destructuring", () => {}); // HIT
function withParam(it) {
  var it = v.it; // HIT
  it.skipIf(!process.env.DATABASE_URL)("redeclared over a parameter", () => {}); // HIT
}

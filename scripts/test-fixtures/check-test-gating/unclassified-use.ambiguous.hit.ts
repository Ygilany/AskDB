import { test } from "vitest";
var picked = test.extend({});
var picked = makeOther();
picked.skipIf(!process.env.DATABASE_URL)("a variable with two initializers", () => {}); // HIT

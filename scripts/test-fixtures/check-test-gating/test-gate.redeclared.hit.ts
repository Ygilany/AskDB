import { test } from "vitest";
var twice = test.extend({});
var twice: typeof twice;
twice.skipIf(!process.env.DATABASE_URL)("a variable declared twice", () => {}); // HIT

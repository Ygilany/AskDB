import { test } from "vitest";
const dbTest = test.extend({ db: async ({}, use) => use(1) });
const pgTest = dbTest.extend({ pg: async ({}, use) => use(2) });
dbTest.skipIf(!process.env.DATABASE_URL)("through a test.extend result", () => {}); // HIT
pgTest.runIf(process.env.DATABASE_URL)("through a chained extend", () => {}); // HIT
test.extend({}).skipIf(!process.env.DATABASE_URL)("inline extend", () => {}); // HIT
dbTest("options on an extend result", { skip: !process.env.DATABASE_URL }, () => {}); // HIT
test.extend({})("inline extend call with options", { skip: !process.env.DATABASE_URL }, () => {}); // HIT
test.extend({}).extend({})("chained inline extend", { skip: !process.env.DATABASE_URL }, () => {}); // HIT
const twice = test.extend({}).extend({});
twice.skipIf(!process.env.DATABASE_URL)("through a stored chained extend", () => {}); // HIT

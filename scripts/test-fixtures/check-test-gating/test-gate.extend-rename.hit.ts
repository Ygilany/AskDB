import { test as baseTest } from "vitest";
const test = baseTest.extend({ db: async ({}, use) => use(1) });
test.skipIf(!process.env.DATABASE_URL)("Vitest's documented extend pattern", () => {}); // HIT
test("options on the renamed extend", { skip: !process.env.DATABASE_URL }, () => {}); // HIT

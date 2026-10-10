import { test as baseTest } from "vitest";
const test = baseTest.extend({ db: async ({}, use) => use(1) });
if (process.env.DATABASE_URL) test("conditional, renamed extend", () => {}); // HIT
if (process.env.DATABASE_URL) baseTest.extend({})("inline extend call", () => {}); // HIT

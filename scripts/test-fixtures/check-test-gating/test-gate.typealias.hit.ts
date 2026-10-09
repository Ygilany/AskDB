import { test } from "vitest";
type dbTest = { db: number };
const dbTest = test.extend<dbTest>({ db: async ({}, use) => use(1) });
dbTest.skipIf(!process.env.DATABASE_URL)("a type and a value share a name", () => {}); // HIT

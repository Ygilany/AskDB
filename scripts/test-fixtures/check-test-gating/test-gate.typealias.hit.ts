import { test } from "vitest";
type dbTest = { db: number };
const dbTest = test.extend<dbTest>({ db: async ({}, use) => use(1) });
dbTest.skipIf(!process.env.DATABASE_URL)("a type and a value share a name", () => {}); // HIT
interface mergedTest { db: number }
const mergedTest = test.extend<mergedTest>({ db: async ({}, use) => use(1) });
mergedTest.skipIf(!process.env.DATABASE_URL)("an interface and a value share a name", () => {}); // HIT

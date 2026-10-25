const run = () => {};
import { test } from "vitest";
const dbTest = test.extend({ db: async ({}, use) => use(1) });
if (process.env.DATABASE_URL) dbTest("conditional extend result", () => {}); // HIT
if (ok) it.each([1, 2])("each under an if %s", run); // HIT
if (ok) describe.each([1, 2])("describe.each under an if %s", run); // HIT

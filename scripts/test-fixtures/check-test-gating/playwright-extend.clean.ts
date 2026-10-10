import { test as base } from "@playwright/test";
const test = base.extend({ page: async ({}, use) => use(1) });
if (ok) test("a Playwright test, not Vitest's", () => {});

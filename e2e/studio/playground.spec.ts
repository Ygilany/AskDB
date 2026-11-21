/**
 * Replay of the UI steps of verify-askdb's `studio-playground` feature
 * (.agents/skills/verify-askdb/features/studio-playground.md). The API steps are studio-api.test.ts.
 *
 * Protects: the Playground as a user drives it: open, generate SQL in Full schema mode, execute it
 * against shop.db and see the rows.
 * Catches: a UI change that breaks the journey (a renamed control, a broken state change, the
 * results never rendering), which the server tests can't see.
 * No production seam: it drives the built Studio by role and accessible name only.
 */
import { expect, studioRun, test } from "./fixtures.js";

const SQL = "SELECT name, country FROM customers ORDER BY name";
const studio = studioRun();

test("studio-open, studio-generate, studio-execute: a question becomes SQL, then rows", async ({ page }, testInfo) => {
  studio.run.modelReply(SQL);
  await page.goto(`${studio.url}/playground`);

  // studio-open
  await expect(page.getByRole("heading", { name: "Query Playground" })).toBeVisible();
  const question = page.getByRole("textbox", { name: "Natural language question" });
  await expect(question).toHaveAttribute("placeholder", "How many users placed orders last month?");
  const mode = page.getByRole("group", { name: "Retrieval mode" });
  await expect(mode.getByRole("button", { name: "Full schema" })).toBeEnabled();
  await expect(mode.getByRole("button", { name: "RAG" })).toBeDisabled();
  await expect(page.getByText("No index")).toBeVisible();
  await expect(page.getByRole("button", { name: "Execute Query" })).toHaveCount(0);

  // studio-generate
  await question.fill("customers by name");
  await page.getByRole("button", { name: /^Generate SQL/ }).click();
  await expect(page.getByText("Generated SQL.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Generated SQL" })).toBeVisible();
  await expect(page.getByText(SQL, { exact: true })).toBeVisible();
  await expect(page.getByText("History (1)")).toBeVisible();
  await expect(page.getByText("better-sqlite3 ready")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("studio-generate.png") });

  // studio-execute
  await page.getByRole("button", { name: "Execute Query" }).click();
  await expect(page.getByText(/^4 rows · \d+ms$/)).toBeVisible();
  const results = page.getByRole("table");
  await expect(results.getByRole("columnheader")).toHaveText(["name", "country"]);
  await expect(results.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText([/Ada\s*UK/, /Grace\s*US/, /Linus\s*FI/, /Margaret\s*US/]);
  await results.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("studio-execute.png") });
});

test("studio-history: a history entry loads from the keyboard and deletes by name", async ({ page }) => {
  studio.run.modelReply(SQL);
  await page.goto(`${studio.url}/playground`);

  // Generate an entry with its own question so its buttons have unique names.
  const question = page.getByRole("textbox", { name: "Natural language question" });
  await question.fill("customers by country");
  await page.getByRole("button", { name: /^Generate SQL/ }).click();
  await expect(page.getByText(SQL, { exact: true })).toBeVisible();
  const loadButton = page.getByRole("button", { name: 'Load "customers by country"' });
  await expect(loadButton).toBeVisible();

  // Load it from the keyboard: focus the entry's button by role and name, press Enter.
  await question.fill("a different question");
  await loadButton.focus();
  await page.keyboard.press("Enter");
  await expect(question).toHaveValue("customers by country");
  await expect(page.getByRole("heading", { name: "Generated SQL" })).toBeVisible();
  await expect(page.getByText(SQL, { exact: true })).toBeVisible();

  // Delete it by its name, then clear any entry the earlier test left, so History disappears.
  await page.getByRole("button", { name: 'Delete "customers by country" from history' }).click();
  await expect(loadButton).toHaveCount(0);
  const earlierEntry = page.getByRole("button", { name: 'Delete "customers by name" from history' });
  if ((await earlierEntry.count()) > 0) await earlierEntry.click();
  await expect(page.getByText("History")).toHaveCount(0);
});

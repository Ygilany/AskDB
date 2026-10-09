import { describe, it, test } from "vitest";
type Suite = typeof describe;
const shape = { describe: 1, it: 2 };
shape.describe;
class Page {
  it() {}
  test = 1;
}
const dbTest = test.extend({ db: async ({}, use) => use(1) });
describe("called directly", () => {
  it("works", () => {});
});

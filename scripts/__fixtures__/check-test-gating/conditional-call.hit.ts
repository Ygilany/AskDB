if (!process.env.DATABASE_URL) it.skip("needs a database", () => {}); // HIT
url ? it("a", run) : noop; // HIT
process.env.DATABASE_URL ? noop : describe("db", run); // HIT
process.env.DATABASE_URL && describe("db", run); // HIT
if (process.env.DATABASE_URL) {
  describe("db", () => {}); // HIT
} else {
  it("explains the skip", () => {}); // HIT
}
const ready = hasDriver() || test("fallback", run); // HIT
const pick = ready ? noop : (flag ? it("nested", run) : describe("nested", run)); // HIT
if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
  describe("not the first statement", run); // HIT
}
switch (engine) {
  case "postgres":
    describe("one engine", run); // HIT
}
const fallback = maybe ?? it("after ??", run); // HIT
ok &&
  test // HIT
    .each`
      a
      ${1}
    `("tagged-template table %s", run);
if (ok) {
  describe("reported once, at the outer suite", () => { // HIT
    it("inside a conditional suite", run);
  });
}
try {
  await import("better-sqlite3");
  describe("sqlite", run); // HIT
} catch {
  it("better-sqlite3 is not installed", () => {}); // HIT
}
if (ok) {
  rows.forEach((r) => it(`row ${r}`, run)); // HIT
}

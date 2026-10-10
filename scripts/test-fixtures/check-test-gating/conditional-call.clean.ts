// Straight-line definitions: at the top level, in a suite or `.each` body, awaited, or after
// statements that can't leave the block first.
const run = () => {};
describe("at the top level", run);
it("a test at the top level", run);
await describe("awaited", run);
describe("a suite body", () => {
  const value = 1;
  it("after a declaration", run);
  describe("a nested suite", () => {
    it("deeper", run);
  });
});
describe.each([1, 2])("an each body %s", () => {
  it("inside", run);
});
describe("an arrow's expression body", () => it("returned to Vitest", run));
for (const x of [1, 2]) {
  if (x === 2) break;
}
it("after a loop whose break stays inside it", run);
switch (1) {
  case 1:
    break;
}
it("after a switch whose break stays inside it", run);
done: {
  if (Date.now() > 0) break done;
}
it("after a labeled block whose break targets its own label", run);
if (Date.now() > 0) console.log("no exit");
it("after an if that doesn't leave", run);
function helper() {
  return 1;
}
it("after a function that returns", run);

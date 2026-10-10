const ids = rows.map((describe) => describe.id);
try {
  load();
} catch (describe) {
  report(describe.skip);
}
function helper() {
  var describe = make();
  return describe.skip;
}
{
  const describe = local();
  describe.skip("block-scoped shadow");
}
describe.skip("a real gate after the shadows", () => {}); // HIT
interface describe {
  readonly x: number;
}
describe.skip("an interface of the same name doesn't shadow the value", () => {}); // HIT

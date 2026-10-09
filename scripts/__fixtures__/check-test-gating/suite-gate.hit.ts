// Every line marked HIT must be reported under this file's rule; no other line may be.
describe.skip("plain skipped suite", () => {}); // HIT
describe.skipIf(!process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.runIf(process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.concurrent.skip("concurrent skipped suite", () => {}); // HIT
suite.skip("suite alias", () => {}); // HIT
suite.skipIf(!ok)("suite alias, gated", () => {}); // HIT
describe // HIT
  .skip("split across lines", () => {});
const note = "// check-test-gating-ignore-next-line: inside a string, so not a pragma";
describe.skip("a pragma inside a string exempts nothing", () => {}); // HIT
// check-test-gating-ignore-next-line:
describe.skip("a pragma with no reason exempts nothing", () => {}); // HIT
describe["skip"]("element access", () => {}); // HIT
/* check-test-gating-ignore-next-line: a block comment is not a pragma */
describe.skip("a pragma in a block comment exempts nothing", () => {}); // HIT

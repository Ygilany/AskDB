// Every line marked HIT must be reported under this file's rule; no other line may be.
describe.skip("plain skipped suite", () => {}); // HIT
describe.skipIf(!process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.runIf(process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.concurrent.skip("concurrent skipped suite", () => {}); // HIT
suite.skip("suite alias", () => {}); // HIT
suite.skipIf(!ok)("suite alias, gated", () => {}); // HIT
describe // HIT
  .skip("split across lines", () => {});

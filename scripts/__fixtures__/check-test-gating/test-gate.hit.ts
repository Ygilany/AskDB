it.skipIf(!process.env.DATABASE_URL)("gated test", () => {}); // HIT
test.runIf(ok)("gated test", () => {}); // HIT
it.concurrent.skipIf(!ok)("concurrent gated test", () => {}); // HIT
test.sequential.runIf(ok)("sequential gated test", () => {}); // HIT

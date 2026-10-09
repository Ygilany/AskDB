const alias = describe; // HIT
(process.env.DATABASE_URL && describe)?.("chosen by &&", run); // HIT
const chosen = process.env.DATABASE_URL || it; // HIT
register(describe); // HIT
describe.call(null, "through .call", run); // HIT
it.apply(null, ["through .apply", run]); // HIT
const bound = test.bind(null); // HIT
const o = { describe }; // HIT
const table = it.each([1, 2]); // HIT

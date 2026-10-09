// check-test-gating-ignore-next-line: exercises Vitest's own skip semantics
describe.skip("an explicitly exempted gate", () => {});
setup(); // check-test-gating-ignore-next-line: a trailing marker exempts the next line too
describe.skip("exempted by a trailing marker", () => {});

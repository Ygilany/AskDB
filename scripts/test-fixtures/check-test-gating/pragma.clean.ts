// check-test-gating-ignore-next-line: exercises Vitest's own skip semantics
describe.skip("an explicitly exempted gate", () => {});
setup(); // check-test-gating-ignore-next-line: a trailing marker exempts the next line too
describe.skip("exempted by a trailing marker", () => {});
/* a block comment above the pragma */
// check-test-gating-ignore-next-line: a pragma below a block comment still applies
describe.skip("exempted after a block comment", () => {});

it.skip("a plain skipped test is allowed", () => {});
test.skip ("spacing before the call is allowed", () => {});
it.skip.each([1, 2])("a skipped table is allowed %s", () => {});
test.skip.each`
  a    | b
  ${1} | ${2}
`("a skipped tagged-template table is allowed", () => {});
it.concurrent.skip("a skipped concurrent test is allowed", () => {});
it
  .skip("a call split across lines is allowed", () => {});

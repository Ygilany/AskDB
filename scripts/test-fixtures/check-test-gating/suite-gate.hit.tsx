render(<p>// check-test-gating-ignore-next-line: JSX text is not a comment</p>);
describe.skip("below JSX text that looks like a pragma", () => {}); // HIT

render(<p>describe.skip and ok ? it : it.skip are only words here</p>);
it("renders a gate name as text", () => {
  render(<code>{"describe.skipIf"}</code>);
});

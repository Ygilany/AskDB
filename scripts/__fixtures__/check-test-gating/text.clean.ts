// describe.skip was removed in favor of integrationSuite()
/* const suite = ok ? describe : describe.skip; */
it("rejects describe.skip in text", () => {
  const sql = "SELECT ? test: 1";
  const other = 'ok ? it : it.skip';
  const tpl = `? describe : ${"describe.skipIf"} it.skip
    ? test : it.runIf`;
  expect(source).toMatch(/describe\.skip|\? describe :/);
  expect(source).not.toMatch(/[/]it\.skipIf/);
});

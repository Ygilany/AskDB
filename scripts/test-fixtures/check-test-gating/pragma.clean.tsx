render(<p>a paragraph of JSX text</p>);
// check-test-gating-ignore-next-line: a real pragma in a file that also has JSX text
describe.skip("exempt in a .tsx file", () => {});

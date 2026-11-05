// Self-test for readme-links.mjs. run.sh runs it (node --test) before check-tarballs.mjs uses
// the rule on the packed tarballs, so `pnpm smoke:install` and CI's preflight job cover it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deadReadmeLinks } from "./readme-links.mjs";

// What a packed package ships, relative to its root.
const ENTRIES = new Set([
  "package.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "dist/index.js",
  "dist/index.d.ts",
  "docs/guide (v2).md",
]);

const fence = "```";

// [case, README text, dead targets it must report]
const CASES = [
  ["inline link into the monorepo", "See [ADR 0011](../../docs/adrs/0011.md).", ["../../docs/adrs/0011.md"]],
  ["image outside the package", "![logo](../../assets/logo.svg)", ["../../assets/logo.svg"]],
  ["link to a file the package doesn't ship", "[source](./src/index.ts)", ["./src/index.ts"]],
  ["reference definition", "[adr]: ../../docs/adrs/0003.md", ["../../docs/adrs/0003.md"]],
  ["reference definition in a blockquote", "> See [the ADR][adr].\n>\n> [adr]: ../../docs/adrs/0003.md", ["../../docs/adrs/0003.md"]],
  ["HTML anchor", '<a href="../../docs/integration/connectors.md">guide</a>', ["../../docs/integration/connectors.md"]],
  ["HTML image, single quotes", "<img src='../../assets/logo.png' alt=''>", ["../../assets/logo.png"]],
  [
    "HTML srcset candidates",
    '<picture><source srcset="../../assets/dark.svg 1x, ../../assets/dark@2x.svg 2x"></picture>',
    ["../../assets/dark.svg", "../../assets/dark@2x.svg"],
  ],
  ["shipped files", "[LICENSE](./LICENSE) and [NOTICE](NOTICE)", []],
  ["shipped directory, with and without a trailing slash", "[dist](./dist) [dist](dist/)", []],
  ["package root", "[root](./)", []],
  ["balanced parentheses and an angle-bracket destination", "[a](docs/guide%20(v2).md) [b](<./docs/guide (v2).md>)", []],
  ["dead link with parentheses, reported whole", "[old](../docs/guide(v1).md)", ["../docs/guide(v1).md"]],
  ["anchor and query on a shipped file", "[a](./LICENSE#grant) [b](./LICENSE?plain=1)", []],
  [
    "absolute URLs and in-page anchors",
    "[docs](https://askdb.tools/) [mail](mailto:a@b.c) [cdn](//cdn.example/x.js) [top](#install)",
    [],
  ],
  [
    "code in a backtick fence",
    `${fence}ts\nconst run = handlers[name](input);\nconst scope = {\n  [tenantRoot]: expandClosure(seedIds),\n};\n${fence}`,
    [],
  ],
  ["code in a tilde fence", "~~~sql\nSELECT [dbo].[fn](42);\n~~~", []],
  ["code in an inline code span", "Call `handlers[name](input)` or ``a[`b`](c)`` directly.", []],
  ["footnote definition", "AskDB returns SQL.[^1]\n\n[^1]: It never runs it.", []],
  [
    "a link after a fenced block is still read",
    `${fence}\nhandlers[name](input)\n${fence}\n\nSee [ADR](../../docs/adrs/0011.md).`,
    ["../../docs/adrs/0011.md"],
  ],
];

for (const [name, readme, expected] of CASES) {
  test(name, () => {
    assert.deepEqual(deadReadmeLinks(readme, ENTRIES), expected);
  });
}

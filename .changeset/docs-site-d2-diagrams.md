---
"@askdb/docs-site": patch
---

The docs site renders diagrams from D2 source (#713). A `d2` fence, or a `.d2` file under `src/assets/diagrams/d2/`, becomes an inline SVG at build time through `astro-d2` and D2's WebAssembly build, so CI and the Pages deploy need no D2 binary. Diagrams follow the site's light and dark toggle. The Quickstart loop is the first diagram redrawn this way, top to bottom so it stays readable on a phone. `STYLE.md` has the diagram rules. Astro moves to 7.4.7, the first release that builds with `astro-d2`. A dev-only `@emnapi/runtime` 1.x dependency keeps `astro check` working: without it, pnpm resolves `@astrojs/check`'s WebAssembly runtime to the 2.0 beta that Astro 7.4.7's bundler brings in, and `astro check` fails to load.

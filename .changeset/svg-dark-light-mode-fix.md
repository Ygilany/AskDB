---
---

docs(docs-site): add dark/light mode support to all SVG diagrams

- Remove forced white background from `.doc-diagram` CSS class so SVGs can render with transparent backgrounds
- Add CSS custom properties and `@media (prefers-color-scheme: dark)` blocks to the quickstart loop, runtime boundary, and package dependencies SVGs so all colors adapt to the user's system theme
- Fix overlapping boxes and off-center layout in the package dependencies SVG
- Add a new defense-in-depth production stack SVG diagram (vertical flow with side annotations) to replace the ASCII code block on the Safety boundaries page

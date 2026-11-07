---
"@askdb/docs-site": patch
---

The last three diagrams that weren't Mermaid are redrawn in it (#713, ADR 0041), so every docs diagram now follows the site's light and dark toggle. How AskDB works shows the five steps, the four `ask()` runs on a loaded schema artifact, and where AskDB stops, in place of the hand-drawn runtime-boundary image. Safety boundaries draws the defense-in-depth stack, in place of its hand-drawn image. Both images switched theme with the reader's OS setting, not the toggle. Deploy as an HTTP service draws the gateway in place of its ASCII art, which showed an arrow from `@askdb/http-api` to the database role; the server never connects to the database. The two SVGs and their unused `.doc-diagram` and `.askdb-diagram` styles are gone, and `STYLE.md` says only the home page's hero art is hand-drawn.

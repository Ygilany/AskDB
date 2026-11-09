---
"@askdb/docs-site": patch
---

Upgrade AskDB splits into a how-to and a reference (#713). `/guides/upgrading/` keeps the steps: check Node, find the releases you cross, upgrade the packages in one step, apply each release's notes oldest first, and check the result. Every release section moves word for word to the new `/reference/upgrade-notes/`, "Upgrade notes by release". A link to an old section anchor, such as a GitHub Release's `/guides/upgrading/#100-beta50`, forwards to that section on the new page. `docs/release.md` points new Releases at the notes page.

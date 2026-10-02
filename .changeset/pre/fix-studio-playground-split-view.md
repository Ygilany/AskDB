---
"@askdb/studio": patch
---

Fix Query Playground split-view layout across screen sizes.

The two-column split (question left, results right) now fills the full available height and each pane scrolls independently. Previously the outer `main-body` padding broke the edge-to-edge divider and `minHeight: 100%` failed to stretch the grid to fill the pane.

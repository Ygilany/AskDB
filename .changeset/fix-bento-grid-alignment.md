---
"@askdb/docs-site": patch
---

Fix bento grid card vertical alignment. Cards in subsequent grid rows were inheriting `margin-top: 1rem` from Starlight's sibling content spacing rule, causing them to appear offset downward. Added `margin-top: 0 !important` to all grid card elements to override this and ensure proper alignment.

---
"@askdb/core": patch
---

The NL→SQL prompt's tenant-policy block also leaves out a scoped table's column path, or a polymorphic table's type or id column, that sits on a table marked `tracked: false`. Such a column belongs on the table itself, but the policy loader only checks that it exists somewhere, so a policy slip could have named an untracked table. With no filter left to print, the block tells the model not to read the table.

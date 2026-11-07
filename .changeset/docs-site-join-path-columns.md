---
"@askdb/docs-site": patch
---

The tenant docs say that a join counts only on the columns the policy declares (#400), drop the join-path limit, and name the limits that remain (hierarchy roots the scope doesn't name, and joined scoped tables' shared scope). The beta.52 upgrade notes cover the change.

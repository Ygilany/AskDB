---
"@askdb/studio": patch
---

The tenant-policy draft lists foreign keys with core's formatter (#898): each one prints under its table as `FK (org_id) -> public.orgs (id)`, in place of Studio's own `Foreign keys:` block. The rule is unchanged: a key goes in only when both of its columns are listed, and the withheld keys still come back as warnings (ADR 0021).

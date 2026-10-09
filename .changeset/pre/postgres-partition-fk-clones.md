---
"@askdb/postgres": patch
---

Stop rendering foreign keys to or from declarative-partition leaves (ADR 0003).

PG11+ clones a foreign key declared on a partitioned table onto every partition, and PG12+ also clones a foreign key that *references* a partitioned table once per referenced partition. The `foreign_keys` catalog template returned those clones, so a table referencing a partitioned table could render relationships to partition leaves that the `tables` template already removes. The template now drops any constraint whose referencing or referenced relation is a partition of a partitioned parent — the same `pg_inherits` predicate `tables` uses. This is equivalent to `conparentid = 0` for cloned constraints but keeps the templates PG10-compatible (`conparentid` is PG11+).

Air-gapped users should re-export the `foreign_keys` template (`askdb introspect templates --engine postgres`). The schema lock hash changes once for databases where FKs reference partitioned tables.

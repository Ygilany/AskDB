---
"@askdb/docs-site": patch
---

The docs say the read-only check refuses `NEXTVAL` and `SETVAL` on MySQL and MariaDB, and `NEXT VALUE FOR` on every dialect (#825): the safety-boundaries page, troubleshooting, the core API's rule table and a beta.50 upgrade note.

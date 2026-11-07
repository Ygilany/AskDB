---
"@askdb/docs-site": patch
---

The CLI reference says `askdb init`'s SQL Server hint leaves out `TrustServerCertificate`, with a comment line that says to add `TrustServerCertificate=True;` for a development server with a self-signed certificate, and links to Connect to SQL Server's certificate step. That guide no longer says `init` writes the key (#803).

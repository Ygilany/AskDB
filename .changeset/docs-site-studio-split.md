---
"@askdb/docs-site": patch
---

The Studio page becomes three (#713). The Studio tour (`studio`, same URL) walks through all seven views, adding RAG Index and Settings with screenshots. The new how-to Enable Studio execute (`guides/enable-studio-execute`) turns on query execution under a read-only role. The new Studio reference (`reference/studio`) lists the flags, what the setup wizard writes and installs, the files Studio touches, what each AI feature sends, the execute guards and the security model. Wrong claims fixed: Studio doesn't open a browser; only some fields have Suggest; the Playground doesn't show the retrieved chunks; the tenant scope is a per-query option; the setup wizard's execute choice reuses the introspection connection's variable; and Studio writes the RAG index's files outside its guarded writer, while its AI and RAG calls aren't limited to loopback clients.

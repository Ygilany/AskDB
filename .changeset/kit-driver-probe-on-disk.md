---
"@askdb/introspect": patch
"@askdb/studio": patch
"@askdb/docs-site": patch
---

Studio loads a database driver it has just installed on Node 24 and 26 without a restart (#669). Node 24 and later keep a failed package lookup for the life of the process, so the execute-driver status check, which asked Node's resolver, hid the driver Studio installed next, and the load then said to restart. The kit's `isDriverInstalled` now checks for `node_modules/<package>/package.json` under `resolveFrom` and its parents, and on `NODE_PATH`, without asking the resolver (under Yarn Plug'n'Play it still asks the resolver). When a driver is on disk but Node can't resolve it, `createOptionalDriverLoader` reads its entry from its `package.json` (the `exports` map under the `node`, `require` and `default` conditions, or `main`) and imports that file by path. It says to restart only when it can't find the entry. The introspection API reference and the connector guide say so.

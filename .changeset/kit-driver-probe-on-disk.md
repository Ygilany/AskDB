---
"@askdb/introspect": patch
"@askdb/studio": patch
"@askdb/docs-site": patch
---

Studio loads a database driver it has just installed on Node 24 and 26 without a restart (#669). Node 24 and later keep a failed package lookup for the life of the process, so the execute-driver status check, which asked Node's resolver, hid the driver Studio installed next, and the load then said to restart. The kit's `isDriverInstalled` now checks for `node_modules/<package>/package.json` under `resolveFrom` and its parents, and in Node's global directories (`NODE_PATH` first), without asking the resolver (under Yarn Plug'n'Play it still asks the resolver). Studio's guided setup uses the same check. When a driver is on disk but Node can't resolve it, `createOptionalDriverLoader` reads its entry from its `package.json` (the `exports` map under the conditions Node's `require` uses, `node`, `module-sync`, `require` and `default`, or `main`) and imports that file by path. It says to restart only when it can't find the entry. The introspection API reference and the connector guide say so.

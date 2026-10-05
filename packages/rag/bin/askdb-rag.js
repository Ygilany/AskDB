#!/usr/bin/env node
// Deprecated: the RAG CLI moved into the `askdb` package. Removed before 1.0.
process.stderr.write(
  "askdb-rag has moved: use `npx askdb rag " + process.argv.slice(2).join(" ") + "`.\n" +
  "`askdb rag` reads rag.store, rag.storeConfig and ai.embedding from askdb.config.*; flags still override.\n",
);
process.exit(1);

#!/usr/bin/env node
// Deprecated: the RAG CLI moved into the `askdb` package. Removed before 1.0.
// Names only the command: the other arguments can hold a connection string's password.
const command = ["index", "query", "setup-store"].includes(process.argv[2]) ? ` ${process.argv[2]}` : "";
process.stderr.write(
  "askdb-rag has moved: use `npx askdb rag" + command + "` (see `npx askdb rag --help` for its flags).\n" +
  "`askdb rag` reads rag.store, rag.storeConfig and ai.embedding from askdb.config.*; flags still override.\n",
);
process.exit(1);

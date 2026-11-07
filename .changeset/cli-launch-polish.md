---
"askdb": patch
---

`askdb` help says "schema directory" instead of "Schema v2" (#273), and marks the experimental surfaces ADR 0030 keeps at 0.x (#662). `askdb --help` tags `studio`, `enrich`, `bundle` and `rag` "(experimental)" and links ADR 0030. `askdb bundle --help` and `askdb rag --help` add a note that a minor release may change them. `askdb init --help` heads its RAG and Studio options "(experimental)", since they write the experimental `rag` and `studio` blocks. A blank `--question` now fails before `askdb ask` looks for a config or a schema, with a message that names `-q / --question` itself, because `@askdb/core`'s message no longer names CLI flags (#719); the exit code is still `1`.

---
"askdb": minor
---

`askdb bundle` loads the schema directory with `loadSchema()`, the loader `ask()` uses, before it writes the bundle, and exits 1 with the loader's error if the directory doesn't load (#796). It used to bundle markdown the loader refuses, such as front-matter that isn't YAML, a tenant policy that doesn't parse, or two table files with the same `id`, and exit 0, so the bundle failed only when a service loaded it. On a failure it writes nothing, and a file already at `--out` stays as it was. A bundle it writes always loads.

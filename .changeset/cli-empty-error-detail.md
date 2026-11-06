---
"askdb": patch
---

`askdb ask` and `askdb init` report an error that has no message of its own by its inner errors (#781), as `askdb introspect` does since #749. Three places printed an empty string for one, such as the `AggregateError` a refused connection throws: the `errMessage` of `askdb ask`'s `askdb.run.error` log event, the `Details:` line when `askdb ask` can't load the schema, and `askdb init`'s `Failed to write config:` line.

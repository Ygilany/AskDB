---
"@askdb/core": patch
---

A model call that fails before giving a reason now names it (#786). A refused connection to the model's server reached `ask()` as the AI SDK's `Cannot connect to API: ` over a message-less `AggregateError`, so `SqlGenerationError`'s message and the `askdb.pipeline.failed` log's `errMessage` ended in a blank. When a failure's message is empty or ends at a colon, both now add the reason from the errors under it: each one's `code` with the `address` (or `hostname`) and `port` it names, such as `ECONNREFUSED 127.0.0.1:11434`, else its `name`. Their message text is never copied, so a URL or key quoted there doesn't reach the error or the log. A message that already gives its reason is unchanged.

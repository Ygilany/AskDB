---
"@askdb/http-api": minor
---

`askdb-http` reads the working directory's `.env` first, and never a `.env` inside `node_modules` (#839). Its first candidate was the `.env` three directories above its `dist` folder, which in an npm install is `node_modules/.env`, so that file won over `./.env`. The working directory's `.env` now comes first. The package folder's and the repository root's follow only when the binary runs from AskDB's own source checkout, never from inside `node_modules`, so an install (or a package folder copied out of one) reads only the working directory's `.env`.

---
"@askdb/http-api": minor
---

`askdb-http` reads the working directory's `.env` first, and never a `.env` inside `node_modules` (#839). Its first candidate was the `.env` three directories above its `dist` folder, which in an npm install is `node_modules/.env`, so that file won over `./.env`. The order is now the working directory's `.env`, the package folder's, then the repository root's when the binary runs from AskDB's own repo, skipping any candidate inside `node_modules`. In an install, only the working directory's `.env` is read.

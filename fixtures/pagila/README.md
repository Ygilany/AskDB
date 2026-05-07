# Pagila dev fixture

Sample **PostgreSQL** database for manual testing and integration-style runs of AskDB `--execute`. This is **fixture infrastructure** (like schema JSON under [`../schemas/`](../schemas/)), not a Docker image of AskDB itself.

Upstream: [devrimgunduz/pagila](https://github.com/devrimgunduz/pagila) (PostgreSQL License).

```bash
# from repository root
docker compose -f fixtures/pagila/docker-compose.yml up --build -d

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/pagila"
```

Pin Pagila SQL at build time: `docker compose -f fixtures/pagila/docker-compose.yml build --build-arg PAGILA_GIT_REF=<commit-sha>`.

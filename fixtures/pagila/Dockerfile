# Dev fixture: PostgreSQL + [Pagila](https://github.com/devrimgunduz/pagila) sample schema/data for local AskDB testing.
# Pagila is distributed under the PostgreSQL License (see upstream repo).
#
# Pinned to postgres:17 rather than `latest`, since Pagila's master branch has started adding
# schema features tied to specific PostgreSQL majors (e.g. uuidv7() and a pgvector-backed table,
# both PG18+) that a floating `latest` base image may or may not support depending on when it was
# built. 17 (not 16) because pagila-data.sql's pg_dump preamble sets `transaction_timeout`, a GUC
# postgres:17 introduced — postgres:16 rejects it as unrecognized.
FROM postgres:17

# Branch, tag, or commit SHA — pin to a commit for repeatable builds:
# docker compose build --build-arg PAGILA_GIT_REF=abc1234
#
# Pinned past master's PG18-only additions (uuidv7() columns, a pgvector `film_embedding`
# table) that postgres:16 can't run. Bump this once the fixture moves to a postgres:18(+pgvector)
# base and re-verify pagila-schema.sql/pagila-data.sql at the new ref import cleanly first.
ARG PAGILA_GIT_REF=23f7fe7a1e9f5772f85fc14f530583ffa258c6d2

ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=postgres
ENV POSTGRES_DB=pagila

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl; \
  curl -fsSL "https://raw.githubusercontent.com/devrimgunduz/pagila/${PAGILA_GIT_REF}/pagila-schema.sql" \
    -o /docker-entrypoint-initdb.d/010-pagila-schema.sql; \
  curl -fsSL "https://raw.githubusercontent.com/devrimgunduz/pagila/${PAGILA_GIT_REF}/pagila-data.sql" \
    -o /docker-entrypoint-initdb.d/020-pagila-data.sql; \
  apt-get purge -y curl; \
  apt-get autoremove -y; \
  rm -rf /var/lib/apt/lists/*

# Dev fixture: PostgreSQL + [Pagila](https://github.com/devrimgunduz/pagila) sample schema/data for local AskDB testing.
# Pagila is distributed under the PostgreSQL License (see upstream repo).
FROM postgres:latest

# Branch, tag, or commit SHA — pin to a commit for repeatable builds:
# docker compose build --build-arg PAGILA_GIT_REF=abc1234
ARG PAGILA_GIT_REF=master

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

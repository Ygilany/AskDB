# AskDB

AskDB is a tool that allows you to ask questions about your data and get answers.

## Features

- Ask questions about your data
- Get answers from your data
- Get answers from your data

## Thoughts
- When plugged into a project, we'd need to provide the database schema in a format that can be indexed/RAG'd or searched for best results.
- When plugged into a project, the developers would need to provide their own API Keys. (BYOAPI)
- The schema would need to be provided in a format that can be indexed/RAG'd or searched for best results.
- we will need to be able to accept different database description formats.
- will need to be able to support different database types.
- we will need to be able to support the addition of a RAG system
- we will need to be able to prompt the user for more information about the database if anything is unclear.
- we will need to be able to give the user the ability to mark certain fields as sensitive and not be included in the RAG process.
- in a database where it may be supporting a multi-tenant environment, we will need to be able to support the ability to ask questions about specific tenants.
- mult-tenanted databases would need to be able to support the ability for the query to be scoped to the tenant (non negotiable).

## Different Modes
- AI only having access to the database schema and would provide a sql query to the database that would then be executed and the results would be passed into a report. (AI doesn't see the data)
- AI only having access to the database schema and would provide provide a sql query to the database as well as a report structure format that would be used alongside the query results to generate a report. (AI doesn't see the data)
- AI having access to the database schema and the query results could be feed into the AI again to provide a summary of the results alongside the report. (AI Sees a subset of the data; users has semi-control over the data that is passed into the AI)
- AI having access to the database and is able to generate the report itself in different AI-enabled formats.

## Different usage ways
- CLI tool to ask questions about a database and get query
- MCP to ask questions about a database and get query
- Web interface to ask questions about a database and get query and results.
- the Web interface is embeddable into other projects as a component.
---
id: table:public.users
name: users
schemaId: orders-users
primaryEntity: user
aliases: [accounts, members]
tags: [pii]
columns:
  - id: table:public.users#id
    aliases: [user_id]
  - id: table:public.users#email
    sensitive: true
  - id: table:public.users#created_at
    aliases: [signup_date, registered_at]
    description: When the user account was created.
---

# Table: users

Registered user accounts. One row per signed-up user.

## Common query language

- "users" and "members" refer to this table
- "new users" usually means accounts created in the selected date range
- "active users" typically means users who placed at least one order

## Business context

Each user has a unique email address used for login. The `email` column is sensitive — filter on it only when necessary and never display it in group-by reports.

## Example questions

- How many users signed up last month?
- Which users placed the most orders?

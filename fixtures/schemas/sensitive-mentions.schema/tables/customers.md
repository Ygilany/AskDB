---
id: table:public.customers
name: customers
schemaId: sensitive-mentions
aliases: [clients, people by email]
columns:
  - id: table:public.customers#contact_pref
    aliases: [contact preference]
    enum: [email, sms]
    description: How we reach the customer.
  - id: table:public.customers#status
    enum: [active, closed]
    description: Closed when the phone number bounces.
  - id: table:public.customers#region
    aliases: [territory]
    enum: [north, south]
    description: Sales region of the account.
---

# Table: customers

Stores each customer's email and phone.

## Common query language

- "reachable" means a customer with an `email` on file

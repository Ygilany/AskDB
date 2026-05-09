---
id: table:public.orders
name: orders
schemaId: orders-users
primaryEntity: order
aliases: [purchases, sales, transactions]
tags: [revenue, transactional]
columns:
  - id: table:public.orders#id
    aliases: [order_id]
  - id: table:public.orders#status
    aliases: [order_status]
    enum: [pending, paid, shipped, cancelled]
    description: Order lifecycle state. Most reporting filters on `paid`.
  - id: table:public.orders#total_amount
    aliases: [revenue, sale_amount]
    description: Stored in cents. Use `total_amount / 100.0` for dollar values.
---

# Table: orders

Customer purchase orders. One row per submitted order.

## Common query language

- "sales" usually means paid orders (`status = 'paid'`)
- "revenue" usually means `sum(total_amount)` where `status = 'paid'`
- "new orders" usually means orders created in the selected date range

## Example questions

- How much revenue did we make last month?
- Which customers placed the most orders?
- How many orders were cancelled this week?

## Business context

Orders move through `pending → paid → shipped` and may end in `cancelled`. The `total_amount` column is stored in cents.

---
concepts:
  - id: concept:customer
    label: Customer
    synonyms: [user, client, buyer, account holder]
    links: [table:users]
    description: A person who has signed up and placed at least one order.
  - id: concept:revenue
    label: Revenue
    synonyms: [sales, gross sales, top line]
    links: [table:orders#total_amount]
    description: Sum of `orders.total_amount` where `status = 'paid'`, expressed in cents.
---

# Concepts

Cross-table vocabulary for common domain terms used in business queries.

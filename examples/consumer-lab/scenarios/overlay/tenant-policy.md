---
schemaId: multi-engine
enforcement: strict

roots:
  - id: table:org.agency
    tenantIdColumn: table:org.agency#agency_id
    label: Agency

scopedTables:
  - id: table:org.program
    scopeThrough:
      - root: table:org.agency
        column: table:org.program#agency_id
  - id: table:people.client
    scopeThrough:
      - root: table:org.agency
        column: table:people.client#agency_id
  - id: table:people.enrollment
    scopeThrough:
      - root: table:org.agency
        column: table:people.enrollment#agency_id
  - id: table:billing.order
    scopeThrough:
      - root: table:org.agency
        column: table:billing.order#agency_id
  - id: table:billing.payment
    scopeThrough:
      - root: table:org.agency
        column: table:billing.payment#agency_id
  - id: table:billing.order_line
    scopeThrough:
      - root: table:org.agency
        join:
          - from: table:billing.order_line#order_id
            to: table:billing.order#order_id
  - id: table:billing.agency_revenue
    scopeThrough:
      - root: table:org.agency
        column: table:billing.agency_revenue#agency_id

globalTables:
  - table:ref.status
---

# Tenant Policy

The lab's tenant policy overlay for the multi-engine fixture (`docs/specs/consumer-lab.md`, "Tenant scoping, by behavior"). The consumer lab writes it into a copy of each engine's introspected schema artifact, with each stable table ID mapped to that artifact's namespace (SQLite renders every table under `public`), and with `enforcement` set per scenario.

## Hierarchy

Agencies are the tenants. An agency can be the child of another agency (`org.agency.parent_agency_id`), to any depth. A parent agency sees its own data and its descendants' data; a child never sees its parent's; nothing outside an agency's tree is visible. The policy declares the flat root `org.agency`: a same-table tree can't be declared yet (#238), so the host expands a `subtree` scope with `resolveTenantDescendants`.

## Scope rules

Programs, clients, enrollments, orders and payments carry a direct `agency_id`. Order lines belong to an agency through their order. The `billing.agency_revenue` view has one row per agency. Statuses are shared by every agency.

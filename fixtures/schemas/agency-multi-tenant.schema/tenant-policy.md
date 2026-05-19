---
schemaId: agency-multi-tenant
enforcement: strict

roots:
  - id: table:public.agencies
    tenantIdColumn: table:public.agencies#id
    label: Agency
  - id: table:public.sub_agencies
    tenantIdColumn: table:public.sub_agencies#id
    label: Sub-Agency
    parent:
      root: table:public.agencies
      foreignKey: table:public.sub_agencies#agency_id
  - id: table:public.clients
    tenantIdColumn: table:public.clients#id
    label: Client
    parent:
      root: table:public.sub_agencies
      foreignKey: table:public.clients#sub_agency_id

hierarchy:
  - parent: table:public.agencies
    child: table:public.sub_agencies
    foreignKey: table:public.sub_agencies#agency_id
  - parent: table:public.sub_agencies
    child: table:public.clients
    foreignKey: table:public.clients#sub_agency_id

scopedTables:
  - id: table:public.orders
    scopeThrough:
      - root: table:public.agencies
        column: table:public.orders#agency_id
  - id: table:public.campaigns
    scopeThrough:
      - root: table:public.agencies
        column: table:public.campaigns#owning_agency
  - id: table:public.appointments
    scopeThrough:
      - root: table:public.clients
        join:
          - from: table:public.appointments#client_id
            to: table:public.clients#id

polymorphicTables:
  - id: table:public.notes
    typeColumn: table:public.notes#owner_type
    idColumn: table:public.notes#owner_id
    mapping:
      agency: table:public.agencies
      sub_agency: table:public.sub_agencies
      client: table:public.clients

globalTables:
  - table:public.lookup_states
  - table:public.service_types
---

# Tenant Policy

This database serves a multi-level agency management platform where data is
partitioned across a three-tier organizational hierarchy.

## Hierarchy

Agencies are the top-level tenants. Each agency can have multiple sub-agencies,
and each sub-agency manages multiple clients. Data flows downward — an agency
admin can see all sub-agency and client data beneath them.

## Scope rules

Most operational tables carry a direct `agency_id` or use a variant column name
like `owning_agency`. The `appointments` table inherits its scope through the
`clients` table — an appointment belongs to a client, and a client belongs to a
sub-agency under an agency.

The `notes` table uses polymorphic ownership: a note can belong to an agency,
sub-agency, or client depending on the `owner_type` discriminator column.

## Sensitive interactions

The `clients` table contains PII columns (`email`, `phone`) marked sensitive in
the schema. Tenant scoping and sensitive-field rules apply independently — a
user scoped to a particular agency still cannot see sensitive client fields
unless the operating mode permits it.

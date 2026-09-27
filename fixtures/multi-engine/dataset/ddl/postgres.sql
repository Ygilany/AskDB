-- AskDB multi-engine fixture: PostgreSQL DDL. Implements dataset/schema.logical.json.
-- Run by the seeder as the owner (superuser) against database askdb_fixture.
-- Idempotent: drops and recreates every fixture object.

DROP SCHEMA IF EXISTS billing, people, org, ref, fixture CASCADE;

CREATE SCHEMA org;
CREATE SCHEMA people;
CREATE SCHEMA billing;
CREATE SCHEMA ref;
CREATE SCHEMA fixture;

CREATE TABLE fixture.fixture_meta (
  dataset_hash varchar(64) NOT NULL,
  seeded_at    timestamp   NOT NULL
);

CREATE TABLE org.agency (
  agency_id        integer      NOT NULL PRIMARY KEY,
  parent_agency_id integer      NULL REFERENCES org.agency (agency_id),
  name             varchar(100) NOT NULL,
  founded_on       date         NOT NULL,
  created_at       timestamp    NOT NULL
);

CREATE TABLE org.program (
  agency_id    integer        NOT NULL REFERENCES org.agency (agency_id),
  program_code varchar(20)    NOT NULL,
  name         varchar(100)   NOT NULL,
  budget       numeric(12, 2) NOT NULL,
  is_active    boolean        NOT NULL,
  starts_on    date           NOT NULL,
  ends_on      date           NULL,
  PRIMARY KEY (agency_id, program_code),
  UNIQUE (agency_id, name)
);

CREATE TABLE ref.status (
  status_code varchar(20) NOT NULL PRIMARY KEY,
  label       varchar(50) NOT NULL
);

CREATE TABLE people.client (
  client_id  integer      NOT NULL PRIMARY KEY,
  agency_id  integer      NOT NULL REFERENCES org.agency (agency_id),
  full_name  varchar(100) NOT NULL,
  email      varchar(254) NOT NULL UNIQUE,
  ssn        varchar(11)  NULL,
  birth_date date         NOT NULL,
  created_at timestamp    NOT NULL
);

CREATE TABLE people.enrollment (
  client_id    integer     NOT NULL REFERENCES people.client (client_id),
  agency_id    integer     NOT NULL,
  program_code varchar(20) NOT NULL,
  enrolled_on  date        NOT NULL,
  exited_on    date        NULL,
  status_code  varchar(20) NOT NULL REFERENCES ref.status (status_code),
  PRIMARY KEY (client_id, program_code),
  FOREIGN KEY (agency_id, program_code) REFERENCES org.program (agency_id, program_code)
);

CREATE TABLE billing."order" (
  order_id  integer        NOT NULL PRIMARY KEY,
  agency_id integer        NOT NULL REFERENCES org.agency (agency_id),
  client_id integer        NOT NULL REFERENCES people.client (client_id),
  placed_at timestamp      NOT NULL,
  total     numeric(10, 2) NOT NULL,
  is_paid   boolean        NOT NULL,
  note      varchar(200)   NULL
);

CREATE TABLE billing.order_line (
  order_id   integer        NOT NULL REFERENCES billing."order" (order_id),
  line_no    integer        NOT NULL,
  sku        varchar(20)    NOT NULL,
  quantity   integer        NOT NULL,
  unit_price numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

-- Declaratively partitioned (ADR 0003): introspection must render billing.payment
-- only, never its partition leaves.
CREATE TABLE billing.payment (
  payment_id integer        NOT NULL,
  paid_on    date           NOT NULL,
  order_id   integer        NOT NULL REFERENCES billing."order" (order_id),
  agency_id  integer        NOT NULL REFERENCES org.agency (agency_id),
  amount     numeric(10, 2) NOT NULL,
  method     varchar(20)    NOT NULL,
  PRIMARY KEY (payment_id, paid_on)
) PARTITION BY RANGE (paid_on);
CREATE TABLE billing.payment_2024 PARTITION OF billing.payment FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE billing.payment_2025 PARTITION OF billing.payment FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE billing.payment_default PARTITION OF billing.payment DEFAULT;

CREATE VIEW billing.agency_revenue AS
SELECT o.agency_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN o.is_paid THEN o.total END), 0) AS paid_total
FROM billing."order" o
GROUP BY o.agency_id;

-- Read-only role used by hosts to execute generated SQL and to introspect.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixture_reader') THEN
    CREATE ROLE fixture_reader LOGIN PASSWORD 'fixture_reader';
  END IF;
END
$$;
ALTER ROLE fixture_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE askdb_fixture TO fixture_reader;
GRANT USAGE ON SCHEMA org, people, billing, ref, fixture TO fixture_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA org, people, billing, ref, fixture TO fixture_reader;

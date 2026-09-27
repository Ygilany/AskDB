-- AskDB multi-engine fixture: SQLite DDL. Implements dataset/schema.logical.json.
-- SQLite has a single schema (main); logical table names are unique across
-- logical schemas, so every table lives in main (see NORMALIZATION.md).
-- The seeder deletes and recreates the database file, so this file only creates.
-- The seeder's dataset hash lives in a sidecar file (multi-engine.sqlite.hash), not a table,
-- so introspection never sees it.
-- Booleans are INTEGER 0/1; dates are ISO 'YYYY-MM-DD' text; timestamps are
-- 'YYYY-MM-DD HH:MM:SS' text (SQLite's own datetime() format).

PRAGMA foreign_keys = ON;

CREATE TABLE agency (
  agency_id        INTEGER      NOT NULL PRIMARY KEY,
  parent_agency_id INTEGER      NULL REFERENCES agency (agency_id),
  name             VARCHAR(100) NOT NULL,
  founded_on       DATE         NOT NULL,
  created_at       TIMESTAMP    NOT NULL
);

CREATE TABLE program (
  agency_id    INTEGER        NOT NULL REFERENCES agency (agency_id),
  program_code VARCHAR(20)    NOT NULL,
  name         VARCHAR(100)   NOT NULL,
  budget       DECIMAL(12, 2) NOT NULL,
  is_active    BOOLEAN        NOT NULL CHECK (is_active IN (0, 1)),
  starts_on    DATE           NOT NULL,
  ends_on      DATE           NULL,
  PRIMARY KEY (agency_id, program_code),
  UNIQUE (agency_id, name)
);

CREATE TABLE status (
  status_code VARCHAR(20) NOT NULL PRIMARY KEY,
  label       VARCHAR(50) NOT NULL
);

CREATE TABLE client (
  client_id  INTEGER      NOT NULL PRIMARY KEY,
  agency_id  INTEGER      NOT NULL REFERENCES agency (agency_id),
  full_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(254) NOT NULL UNIQUE,
  ssn        VARCHAR(11)  NULL,
  birth_date DATE         NOT NULL,
  created_at TIMESTAMP    NOT NULL
);

CREATE TABLE enrollment (
  client_id    INTEGER     NOT NULL REFERENCES client (client_id),
  agency_id    INTEGER     NOT NULL,
  program_code VARCHAR(20) NOT NULL,
  enrolled_on  DATE        NOT NULL,
  exited_on    DATE        NULL,
  status_code  VARCHAR(20) NOT NULL REFERENCES status (status_code),
  PRIMARY KEY (client_id, program_code),
  FOREIGN KEY (agency_id, program_code) REFERENCES program (agency_id, program_code)
);

CREATE TABLE "order" (
  order_id  INTEGER        NOT NULL PRIMARY KEY,
  agency_id INTEGER        NOT NULL REFERENCES agency (agency_id),
  client_id INTEGER        NOT NULL REFERENCES client (client_id),
  placed_at TIMESTAMP      NOT NULL,
  total     DECIMAL(10, 2) NOT NULL,
  is_paid   BOOLEAN        NOT NULL CHECK (is_paid IN (0, 1)),
  note      VARCHAR(200)   NULL
);

CREATE TABLE order_line (
  order_id   INTEGER        NOT NULL REFERENCES "order" (order_id),
  line_no    INTEGER        NOT NULL,
  sku        VARCHAR(20)    NOT NULL,
  quantity   INTEGER        NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE payment (
  payment_id INTEGER        NOT NULL,
  paid_on    DATE           NOT NULL,
  order_id   INTEGER        NOT NULL REFERENCES "order" (order_id),
  agency_id  INTEGER        NOT NULL REFERENCES agency (agency_id),
  amount     DECIMAL(10, 2) NOT NULL,
  method     VARCHAR(20)    NOT NULL,
  PRIMARY KEY (payment_id, paid_on)
);

CREATE VIEW agency_revenue AS
SELECT o.agency_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN o.is_paid = 1 THEN o.total END), 0) AS paid_total
FROM "order" o
GROUP BY o.agency_id;

-- AskDB consumer lab: MySQL 8.4 DDL. Implements dataset/schema.logical.json.
-- MySQL has no schemas inside a database, and AskDB's MySQL connector introspects only
-- the connection's database, so every logical table lives in one database, askdb_lab
-- (table names are unique across logical schemas; see NORMALIZATION.md). The seeder's
-- bookkeeping lives in a separate database, lab, so introspection never sees it.
-- Run by the seeder as root with multipleStatements. Idempotent.

DROP DATABASE IF EXISTS askdb_lab;
DROP DATABASE IF EXISTS lab;

CREATE DATABASE askdb_lab CHARACTER SET utf8mb4;
CREATE DATABASE lab CHARACTER SET utf8mb4;

CREATE TABLE lab.lab_meta (
  dataset_hash VARCHAR(64) NOT NULL,
  seeded_at    DATETIME    NOT NULL
);

CREATE TABLE askdb_lab.agency (
  agency_id  INT          NOT NULL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  founded_on DATE         NOT NULL,
  created_at DATETIME     NOT NULL
);

CREATE TABLE askdb_lab.program (
  agency_id    INT            NOT NULL,
  program_code VARCHAR(20)    NOT NULL,
  name         VARCHAR(100)   NOT NULL,
  budget       DECIMAL(12, 2) NOT NULL,
  is_active    BOOLEAN        NOT NULL,
  starts_on    DATE           NOT NULL,
  ends_on      DATE           NULL,
  PRIMARY KEY (agency_id, program_code),
  UNIQUE KEY uq_program_agency_name (agency_id, name),
  CONSTRAINT fk_program_agency FOREIGN KEY (agency_id) REFERENCES askdb_lab.agency (agency_id)
);

CREATE TABLE askdb_lab.status (
  status_code VARCHAR(20) NOT NULL PRIMARY KEY,
  label       VARCHAR(50) NOT NULL
);

CREATE TABLE askdb_lab.client (
  client_id  INT          NOT NULL PRIMARY KEY,
  agency_id  INT          NOT NULL,
  full_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  ssn        VARCHAR(11)  NULL,
  birth_date DATE         NOT NULL,
  created_at DATETIME     NOT NULL,
  UNIQUE KEY uq_client_email (email),
  CONSTRAINT fk_client_agency FOREIGN KEY (agency_id) REFERENCES askdb_lab.agency (agency_id)
);

CREATE TABLE askdb_lab.enrollment (
  client_id    INT         NOT NULL,
  agency_id    INT         NOT NULL,
  program_code VARCHAR(20) NOT NULL,
  enrolled_on  DATE        NOT NULL,
  exited_on    DATE        NULL,
  status_code  VARCHAR(20) NOT NULL,
  PRIMARY KEY (client_id, program_code),
  CONSTRAINT fk_enrollment_client FOREIGN KEY (client_id) REFERENCES askdb_lab.client (client_id),
  CONSTRAINT fk_enrollment_program FOREIGN KEY (agency_id, program_code) REFERENCES askdb_lab.program (agency_id, program_code),
  CONSTRAINT fk_enrollment_status FOREIGN KEY (status_code) REFERENCES askdb_lab.status (status_code)
);

CREATE TABLE askdb_lab.`order` (
  order_id  INT            NOT NULL PRIMARY KEY,
  agency_id INT            NOT NULL,
  client_id INT            NOT NULL,
  placed_at DATETIME       NOT NULL,
  total     DECIMAL(10, 2) NOT NULL,
  is_paid   BOOLEAN        NOT NULL,
  note      VARCHAR(200)   NULL,
  CONSTRAINT fk_order_agency FOREIGN KEY (agency_id) REFERENCES askdb_lab.agency (agency_id),
  CONSTRAINT fk_order_client FOREIGN KEY (client_id) REFERENCES askdb_lab.client (client_id)
);

CREATE TABLE askdb_lab.order_line (
  order_id   INT            NOT NULL,
  line_no    INT            NOT NULL,
  sku        VARCHAR(20)    NOT NULL,
  quantity   INT            NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT fk_order_line_order FOREIGN KEY (order_id) REFERENCES askdb_lab.`order` (order_id)
);

CREATE VIEW askdb_lab.agency_revenue AS
SELECT o.agency_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN o.is_paid THEN o.total END), 0) AS paid_total
FROM askdb_lab.`order` o
GROUP BY o.agency_id;

-- Read-only login used by the host to execute generated SQL and to introspect.
CREATE USER IF NOT EXISTS 'lab_reader'@'%' IDENTIFIED BY 'lab_reader';
GRANT SELECT, SHOW VIEW ON askdb_lab.* TO 'lab_reader'@'%';
GRANT SELECT ON lab.* TO 'lab_reader'@'%';

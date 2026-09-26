-- AskDB multi-engine fixture: MariaDB 11.4 DDL. Implements dataset/schema.logical.json.
-- Starts as a copy of mysql.sql; kept separate so MariaDB-specific drift stays visible.
-- MySQL has no schemas inside a database, so each logical schema is a database
-- (org, people, billing, ref), as a real multi-database MySQL deployment would be.
-- The seeder's bookkeeping lives in a separate `fixture` database.
-- Run by the seeder as root with multipleStatements. Idempotent.

DROP DATABASE IF EXISTS billing;
DROP DATABASE IF EXISTS people;
DROP DATABASE IF EXISTS org;
DROP DATABASE IF EXISTS ref;
DROP DATABASE IF EXISTS fixture;

CREATE DATABASE org CHARACTER SET utf8mb4;
CREATE DATABASE people CHARACTER SET utf8mb4;
CREATE DATABASE billing CHARACTER SET utf8mb4;
CREATE DATABASE ref CHARACTER SET utf8mb4;
CREATE DATABASE fixture CHARACTER SET utf8mb4;

CREATE TABLE fixture.fixture_meta (
  dataset_hash VARCHAR(64) NOT NULL,
  seeded_at    DATETIME    NOT NULL
);

CREATE TABLE org.agency (
  agency_id        INT          NOT NULL PRIMARY KEY,
  parent_agency_id INT          NULL,
  name             VARCHAR(100) NOT NULL,
  founded_on       DATE         NOT NULL,
  created_at       DATETIME     NOT NULL,
  CONSTRAINT fk_agency_parent FOREIGN KEY (parent_agency_id) REFERENCES org.agency (agency_id)
);

CREATE TABLE org.program (
  agency_id    INT            NOT NULL,
  program_code VARCHAR(20)    NOT NULL,
  name         VARCHAR(100)   NOT NULL,
  budget       DECIMAL(12, 2) NOT NULL,
  is_active    BOOLEAN        NOT NULL,
  starts_on    DATE           NOT NULL,
  ends_on      DATE           NULL,
  PRIMARY KEY (agency_id, program_code),
  UNIQUE KEY uq_program_agency_name (agency_id, name),
  CONSTRAINT fk_program_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id)
);

CREATE TABLE ref.status (
  status_code VARCHAR(20) NOT NULL PRIMARY KEY,
  label       VARCHAR(50) NOT NULL
);

CREATE TABLE people.client (
  client_id  INT          NOT NULL PRIMARY KEY,
  agency_id  INT          NOT NULL,
  full_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  ssn        VARCHAR(11)  NULL,
  birth_date DATE         NOT NULL,
  created_at DATETIME     NOT NULL,
  UNIQUE KEY uq_client_email (email),
  CONSTRAINT fk_client_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id)
);

CREATE TABLE people.enrollment (
  client_id    INT         NOT NULL,
  agency_id    INT         NOT NULL,
  program_code VARCHAR(20) NOT NULL,
  enrolled_on  DATE        NOT NULL,
  exited_on    DATE        NULL,
  status_code  VARCHAR(20) NOT NULL,
  PRIMARY KEY (client_id, program_code),
  CONSTRAINT fk_enrollment_client FOREIGN KEY (client_id) REFERENCES people.client (client_id),
  CONSTRAINT fk_enrollment_program FOREIGN KEY (agency_id, program_code) REFERENCES org.program (agency_id, program_code),
  CONSTRAINT fk_enrollment_status FOREIGN KEY (status_code) REFERENCES ref.status (status_code)
);

CREATE TABLE billing.`order` (
  order_id  INT            NOT NULL PRIMARY KEY,
  agency_id INT            NOT NULL,
  client_id INT            NOT NULL,
  placed_at DATETIME       NOT NULL,
  total     DECIMAL(10, 2) NOT NULL,
  is_paid   BOOLEAN        NOT NULL,
  note      VARCHAR(200)   NULL,
  CONSTRAINT fk_order_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id),
  CONSTRAINT fk_order_client FOREIGN KEY (client_id) REFERENCES people.client (client_id)
);

CREATE TABLE billing.order_line (
  order_id   INT            NOT NULL,
  line_no    INT            NOT NULL,
  sku        VARCHAR(20)    NOT NULL,
  quantity   INT            NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT fk_order_line_order FOREIGN KEY (order_id) REFERENCES billing.`order` (order_id)
);

-- Partitioned only in Postgres (MySQL partitioned tables cannot have foreign keys).
CREATE TABLE billing.payment (
  payment_id INT            NOT NULL,
  paid_on    DATE           NOT NULL,
  order_id   INT            NOT NULL,
  agency_id  INT            NOT NULL,
  amount     DECIMAL(10, 2) NOT NULL,
  method     VARCHAR(20)    NOT NULL,
  PRIMARY KEY (payment_id, paid_on),
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES billing.`order` (order_id),
  CONSTRAINT fk_payment_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id)
);

CREATE VIEW billing.agency_revenue AS
SELECT o.agency_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN o.is_paid THEN o.total END), 0) AS paid_total
FROM billing.`order` o
GROUP BY o.agency_id;

-- Read-only login used by hosts to execute generated SQL and to introspect.
CREATE USER IF NOT EXISTS 'fixture_reader'@'%' IDENTIFIED BY 'fixture_reader';
GRANT SELECT, SHOW VIEW ON org.* TO 'fixture_reader'@'%';
GRANT SELECT, SHOW VIEW ON people.* TO 'fixture_reader'@'%';
GRANT SELECT, SHOW VIEW ON billing.* TO 'fixture_reader'@'%';
GRANT SELECT, SHOW VIEW ON ref.* TO 'fixture_reader'@'%';
GRANT SELECT ON fixture.* TO 'fixture_reader'@'%';

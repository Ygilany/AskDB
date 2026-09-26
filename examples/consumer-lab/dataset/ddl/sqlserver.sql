-- AskDB consumer lab: SQL Server 2022 DDL. Implements dataset/schema.logical.json.
-- The seeder recreates database askdb_lab, then runs this file inside it,
-- batch by batch (batches are separated by lines containing only GO).

CREATE SCHEMA org;
GO
CREATE SCHEMA people;
GO
CREATE SCHEMA billing;
GO
CREATE SCHEMA ref;
GO
CREATE SCHEMA lab;
GO

CREATE TABLE lab.lab_meta (
  dataset_hash VARCHAR(64)  NOT NULL,
  seeded_at    DATETIME2(0) NOT NULL
);

CREATE TABLE org.agency (
  agency_id  INT           NOT NULL PRIMARY KEY,
  name       NVARCHAR(100) NOT NULL,
  founded_on DATE          NOT NULL,
  created_at DATETIME2(0)  NOT NULL
);

CREATE TABLE org.program (
  agency_id    INT            NOT NULL,
  program_code NVARCHAR(20)   NOT NULL,
  name         NVARCHAR(100)  NOT NULL,
  budget       DECIMAL(12, 2) NOT NULL,
  is_active    BIT            NOT NULL,
  starts_on    DATE           NOT NULL,
  ends_on      DATE           NULL,
  CONSTRAINT pk_program PRIMARY KEY (agency_id, program_code),
  CONSTRAINT uq_program_agency_name UNIQUE (agency_id, name),
  CONSTRAINT fk_program_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id)
);

CREATE TABLE ref.status (
  status_code NVARCHAR(20) NOT NULL PRIMARY KEY,
  label       NVARCHAR(50) NOT NULL
);

CREATE TABLE people.client (
  client_id  INT           NOT NULL PRIMARY KEY,
  agency_id  INT           NOT NULL,
  full_name  NVARCHAR(100) NOT NULL,
  email      NVARCHAR(254) NOT NULL,
  ssn        NVARCHAR(11)  NULL,
  birth_date DATE          NOT NULL,
  created_at DATETIME2(0)  NOT NULL,
  CONSTRAINT uq_client_email UNIQUE (email),
  CONSTRAINT fk_client_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id)
);

CREATE TABLE people.enrollment (
  client_id    INT          NOT NULL,
  agency_id    INT          NOT NULL,
  program_code NVARCHAR(20) NOT NULL,
  enrolled_on  DATE         NOT NULL,
  exited_on    DATE         NULL,
  status_code  NVARCHAR(20) NOT NULL,
  CONSTRAINT pk_enrollment PRIMARY KEY (client_id, program_code),
  CONSTRAINT fk_enrollment_client FOREIGN KEY (client_id) REFERENCES people.client (client_id),
  CONSTRAINT fk_enrollment_program FOREIGN KEY (agency_id, program_code) REFERENCES org.program (agency_id, program_code),
  CONSTRAINT fk_enrollment_status FOREIGN KEY (status_code) REFERENCES ref.status (status_code)
);

CREATE TABLE billing.[order] (
  order_id  INT            NOT NULL PRIMARY KEY,
  agency_id INT            NOT NULL,
  client_id INT            NOT NULL,
  placed_at DATETIME2(0)   NOT NULL,
  total     DECIMAL(10, 2) NOT NULL,
  is_paid   BIT            NOT NULL,
  note      NVARCHAR(200)  NULL,
  CONSTRAINT fk_order_agency FOREIGN KEY (agency_id) REFERENCES org.agency (agency_id),
  CONSTRAINT fk_order_client FOREIGN KEY (client_id) REFERENCES people.client (client_id)
);

CREATE TABLE billing.order_line (
  order_id   INT            NOT NULL,
  line_no    INT            NOT NULL,
  sku        NVARCHAR(20)   NOT NULL,
  quantity   INT            NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  CONSTRAINT pk_order_line PRIMARY KEY (order_id, line_no),
  CONSTRAINT fk_order_line_order FOREIGN KEY (order_id) REFERENCES billing.[order] (order_id)
);
GO

CREATE VIEW billing.agency_revenue AS
SELECT o.agency_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(CASE WHEN o.is_paid = 1 THEN o.total END), 0) AS paid_total
FROM billing.[order] o
GROUP BY o.agency_id;
GO

-- Read-only login used by the host to execute generated SQL and to introspect.
-- The login is server-level and survives database recreation; the user is per database.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'lab_reader')
  CREATE LOGIN lab_reader WITH PASSWORD = 'Lab.Reader.2026', CHECK_POLICY = OFF;
GO
CREATE USER lab_reader FOR LOGIN lab_reader;
ALTER ROLE db_datareader ADD MEMBER lab_reader;
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE ON DATABASE::askdb_lab TO lab_reader;
GO

-- ISH Invoice System — Database Schema
-- Run this file to set up the database

CREATE DATABASE IF NOT EXISTS ish_invoice CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ish_invoice;

-- ─── Auth ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('superadmin','my_admin','malaysian_admin') NOT NULL DEFAULT 'my_admin',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by    INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── System Settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(100) NOT NULL PRIMARY KEY,
  `value`     TEXT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── Business Profiles (multi-brand invoice sender) ──────────────────────────
CREATE TABLE IF NOT EXISTS business_profiles (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  logo_path           VARCHAR(500) NULL,
  address             TEXT NULL,
  email               VARCHAR(150) NULL,
  phone               VARCHAR(50) NULL,
  bank_name           VARCHAR(150) NULL,
  bank_account_number VARCHAR(100) NULL,
  bank_account_name   VARCHAR(150) NULL,
  is_default          TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── Shopee Affiliate Module ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_accounts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(200) NOT NULL,
  bank_name      VARCHAR(150) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  phone          VARCHAR(50) NULL,
  notes          TEXT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payout_periods (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  period_number        VARCHAR(30) NOT NULL UNIQUE,   -- ISH-PAY-2026-001
  period_label         VARCHAR(150) NOT NULL,
  payout_date          DATE NOT NULL,
  shopee_invoice_path  VARCHAR(500) NULL,
  deduction_percent    DECIMAL(5,2) NULL,              -- NULL = use global default
  total_gross          DECIMAL(12,2) NOT NULL DEFAULT 0,
  deduction_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_to_ish           DECIMAL(12,2) NOT NULL DEFAULT 0,
  transfer_proof_path  VARCHAR(500) NULL,
  transfer_date        DATE NULL,
  status               ENUM('open','submitted','transferring','pending_confirmation','complete') NOT NULL DEFAULT 'open',
  notes                TEXT NULL,
  created_by           INT NOT NULL,
  settled_by           INT NULL,
  confirmed_by         INT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by)   REFERENCES users(id),
  FOREIGN KEY (settled_by)   REFERENCES users(id),
  FOREIGN KEY (confirmed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payout_entries (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  payout_period_id     INT NOT NULL,
  affiliate_account_id INT NULL,                       -- NULL if unmatched from OCR
  extracted_name       VARCHAR(200) NULL,              -- raw OCR name
  payout_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_status       ENUM('processing','collected','failed') NOT NULL DEFAULT 'processing',
  payment_time         DATETIME NULL,
  collected_by         INT NULL,
  notes                TEXT NULL,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (payout_period_id)     REFERENCES payout_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (affiliate_account_id) REFERENCES affiliate_accounts(id),
  FOREIGN KEY (collected_by)         REFERENCES users(id)
);

-- ─── Dev Invoice Module ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  company    VARCHAR(200) NULL,
  email      VARCHAR(150) NULL,
  phone      VARCHAR(50) NULL,
  address    TEXT NULL,
  country    VARCHAR(100) NULL DEFAULT 'Malaysia',
  currency   VARCHAR(10) NOT NULL DEFAULT 'MYR',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  client_id     INT NOT NULL,
  project_name  VARCHAR(200) NOT NULL,
  description   TEXT NULL,
  scope_md_path VARCHAR(500) NULL,
  status        ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  project_id           INT NOT NULL,
  business_profile_id  INT NOT NULL,
  invoice_number       VARCHAR(30) NOT NULL UNIQUE,    -- ISH-INV-2026-001
  issue_date           DATE NOT NULL,
  due_date             DATE NULL,
  payment_type         ENUM('full','milestone') NOT NULL DEFAULT 'full',
  subtotal             DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_percent          DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  total                DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid          DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_due          DECIMAL(12,2) NOT NULL DEFAULT 0,
  status               ENUM('draft','sent','partial','paid') NOT NULL DEFAULT 'draft',
  notes                TEXT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id)          REFERENCES projects(id),
  FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id   INT NOT NULL,
  phase_label  VARCHAR(200) NULL,
  description  TEXT NOT NULL,
  quantity     DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_milestones (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  label      VARCHAR(200) NOT NULL,
  percent    DECIMAL(5,2) NOT NULL DEFAULT 0,
  amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date   DATE NULL,
  status     ENUM('pending','invoiced','paid') NOT NULL DEFAULT 'pending',
  paid_at    DATETIME NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id   INT NOT NULL,
  milestone_id INT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  method       VARCHAR(100) NULL,
  reference    VARCHAR(200) NULL,
  notes        TEXT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id)   REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES invoice_milestones(id)
);

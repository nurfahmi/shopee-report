const db = require('./database');
const fs = require('fs');
const path = require('path');

async function syncDatabase() {
  const mysql = require('mysql2/promise');

  // First connect without database to create it if needed
  const connection = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     process.env.DB_PORT || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  const dbName = process.env.DB_NAME || 'ish_invoice';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${dbName}\``);

  // Create all tables (IF NOT EXISTS = safe to run every time)
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role          ENUM('superadmin','my_admin','malaysian_admin') NOT NULL DEFAULT 'my_admin',
      is_active     TINYINT(1) NOT NULL DEFAULT 1,
      created_by    INT NULL,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      \`key\`       VARCHAR(100) NOT NULL PRIMARY KEY,
      \`value\`     TEXT NULL,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS business_profiles (
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
    )`,
    `CREATE TABLE IF NOT EXISTS studios (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(200) NOT NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_accounts (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      studio_id      INT NULL,
      full_name      VARCHAR(200) NOT NULL,
      bank_name      VARCHAR(150) NOT NULL,
      account_number VARCHAR(100) NOT NULL,
      phone          VARCHAR(50) NULL,
      notes          TEXT NULL,
      is_active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS payout_periods (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      period_number        VARCHAR(30) NOT NULL UNIQUE,
      period_label         VARCHAR(150) NOT NULL,
      payout_date          DATE NOT NULL,
      shopee_invoice_path  VARCHAR(500) NULL,
      deduction_percent    DECIMAL(5,2) NULL,
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
    )`,
    `CREATE TABLE IF NOT EXISTS payout_entries (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      payout_period_id     INT NULL,
      affiliate_account_id INT NULL,
      extracted_name       VARCHAR(200) NULL,
      invoice_file_path    VARCHAR(500) NULL,
      invoice_date         DATE NULL,
      period_description   VARCHAR(200) NULL,
      payout_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax_amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
      payout_amount_idr    DECIMAL(15,2) NOT NULL DEFAULT 0,
      payment_status       ENUM('processing','collected','transferring','received','distributed','completed') NOT NULL DEFAULT 'processing',
      payment_time             DATETIME NULL,
      collected_by             INT NULL,
      transfer_proof_path      VARCHAR(500) NULL,
      distribution_proof_path  VARCHAR(500) NULL,
      notes                    TEXT NULL,
      sort_order           INT NOT NULL DEFAULT 0,
      created_by           INT NULL,
      created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_period_id)     REFERENCES payout_periods(id) ON DELETE SET NULL,
      FOREIGN KEY (affiliate_account_id) REFERENCES affiliate_accounts(id),
      FOREIGN KEY (collected_by)         REFERENCES users(id),
      FOREIGN KEY (created_by)           REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS payout_history (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      payout_period_id INT NOT NULL,
      payout_entry_id  INT NULL,
      action           VARCHAR(100) NOT NULL,
      details          TEXT NULL,
      performed_by     INT NOT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_period_id) REFERENCES payout_periods(id) ON DELETE CASCADE,
      FOREIGN KEY (payout_entry_id)  REFERENCES payout_entries(id) ON DELETE SET NULL,
      FOREIGN KEY (performed_by)     REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
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
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      client_id     INT NOT NULL,
      project_name  VARCHAR(200) NOT NULL,
      description   TEXT NULL,
      scope_md_path VARCHAR(500) NULL,
      status        ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      project_id           INT NOT NULL,
      business_profile_id  INT NOT NULL,
      invoice_number       VARCHAR(30) NOT NULL UNIQUE,
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
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_items (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id   INT NOT NULL,
      phase_label  VARCHAR(200) NULL,
      description  TEXT NOT NULL,
      quantity     DECIMAL(10,2) NOT NULL DEFAULT 1,
      unit_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
      sort_order   INT NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_milestones (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      label      VARCHAR(200) NOT NULL,
      percent    DECIMAL(5,2) NOT NULL DEFAULT 0,
      amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
      due_date   DATE NULL,
      status     ENUM('pending','invoiced','paid') NOT NULL DEFAULT 'pending',
      paid_at    DATETIME NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
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
    )`,

    // ── Finance module: staff payroll + monthly expenses (ID admin / SA only) ──
    // All amounts are in IDR. Staff are either hourly (rate × hours) or fixed
    // (monthly salary). Daily lunch cashback is optional and applies to days_worked.
    `CREATE TABLE IF NOT EXISTS finance_staff (
      id                          INT AUTO_INCREMENT PRIMARY KEY,
      studio_id                   INT NULL,
      name                        VARCHAR(150) NOT NULL,
      role_title                  VARCHAR(150) NULL,
      salary_type                 ENUM('hourly','fixed') NOT NULL DEFAULT 'hourly',
      hourly_rate_idr             DECIMAL(15,2) NULL,
      monthly_salary_idr          DECIMAL(15,2) NULL,
      lunch_cashback_per_day_idr  DECIMAL(12,2) NULL,
      tunjangan_idr               DECIMAL(15,2) NULL,
      notes                       TEXT NULL,
      is_active                   TINYINT(1) NOT NULL DEFAULT 1,
      created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_finance_staff_studio (studio_id)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_periods (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      studio_id   INT NULL,
      year        INT NOT NULL,
      month       TINYINT NOT NULL,
      notes       TEXT NULL,
      status      ENUM('draft','final') NOT NULL DEFAULT 'draft',
      created_by  INT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_finance_studio_year_month (studio_id, year, month)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_staff_payouts (
      id                            INT AUTO_INCREMENT PRIMARY KEY,
      finance_period_id             INT NOT NULL,
      staff_id                      INT NOT NULL,
      hours_worked                  DECIMAL(8,2) NOT NULL DEFAULT 0,
      days_worked                   INT NOT NULL DEFAULT 0,
      salary_type_snapshot          ENUM('hourly','fixed') NOT NULL DEFAULT 'hourly',
      hourly_rate_snapshot_idr      DECIMAL(15,2) NULL,
      monthly_salary_snapshot_idr   DECIMAL(15,2) NULL,
      lunch_cashback_snapshot_idr   DECIMAL(12,2) NULL,
      tunjangan_snapshot_idr        DECIMAL(15,2) NULL,
      calculated_amount_idr         DECIMAL(15,2) NOT NULL DEFAULT 0,
      notes                         TEXT NULL,
      created_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_period_staff (finance_period_id, staff_id),
      FOREIGN KEY (finance_period_id) REFERENCES finance_periods(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id)          REFERENCES finance_staff(id)   ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS finance_expenses (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      finance_period_id INT NOT NULL,
      category          VARCHAR(100) NOT NULL,
      description       VARCHAR(500) NULL,
      amount_idr        DECIMAL(15,2) NOT NULL DEFAULT 0,
      expense_date      DATE NULL,
      notes             TEXT NULL,
      created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (finance_period_id) REFERENCES finance_periods(id) ON DELETE CASCADE
    )`,
    // Other income — revenue streams beyond Shopee distributions (e.g. AdSense,
    // sponsorships, brand deals). Manually entered per period.
    `CREATE TABLE IF NOT EXISTS finance_other_income (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      finance_period_id INT NOT NULL,
      source            VARCHAR(100) NOT NULL,
      description       VARCHAR(500) NULL,
      amount_idr        DECIMAL(15,2) NOT NULL DEFAULT 0,
      income_date       DATE NULL,
      notes             TEXT NULL,
      created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (finance_period_id) REFERENCES finance_periods(id) ON DELETE CASCADE
    )`
  ];

  for (const sql of tables) {
    await connection.query(sql);
  }

  // ── Migrations: add columns if missing (MySQL 5.7+ compatible) ──
  async function addColumnIfMissing(conn, table, column, definition) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [dbName, table, column]
    );
    if (rows[0].c === 0) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  }

  await addColumnIfMissing(connection, 'payout_entries', 'invoice_number', 'VARCHAR(100) NULL AFTER extracted_name');
  await addColumnIfMissing(connection, 'payout_entries', 'invoice_file_path', 'VARCHAR(500) NULL AFTER invoice_number');
  await addColumnIfMissing(connection, 'payout_entries', 'invoice_date', 'DATE NULL AFTER invoice_file_path');
  await addColumnIfMissing(connection, 'payout_entries', 'period_description', 'VARCHAR(200) NULL AFTER invoice_date');
  await addColumnIfMissing(connection, 'payout_entries', 'tax_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER payout_amount');
  await addColumnIfMissing(connection, 'payout_entries', 'payout_amount_idr', 'DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER tax_amount');
  await addColumnIfMissing(connection, 'payout_entries', 'created_by', 'INT NULL AFTER sort_order');

  // ── Actual-amount tracking (role-grouped UX redesign) ───────────
  await addColumnIfMissing(connection, 'payout_entries', 'actual_collected_myr',  'DECIMAL(12,2) NULL AFTER payout_amount_idr');
  await addColumnIfMissing(connection, 'payout_entries', 'actual_distributed_idr', 'DECIMAL(15,2) NULL AFTER actual_collected_myr');
  await addColumnIfMissing(connection, 'payout_entries', 'actual_fx_rate',         'DECIMAL(12,6) NULL AFTER actual_distributed_idr');
  // What actually reached ID admin per entry (sum across batch may differ from expected).
  // Allocated proportionally from the bulk transfer's actual MYR total.
  await addColumnIfMissing(connection, 'payout_entries', 'actual_received_myr',    'DECIMAL(12,2) NULL AFTER actual_fx_rate');

  // Make payout_period_id nullable (was NOT NULL in old schema)
  try { await connection.query('ALTER TABLE payout_entries MODIFY COLUMN payout_period_id INT NULL'); } catch(e) {}

  // Unique index on invoice_number for duplicate prevention
  try { await connection.query('CREATE UNIQUE INDEX idx_invoice_number ON payout_entries (invoice_number)'); } catch(e) {}

  // ── Studio role migrations ──────────────────────────────────────
  // Add studio_id to users
  await addColumnIfMissing(connection, 'users', 'studio_id', 'INT NULL AFTER role');

  // Add studio_id to affiliate_accounts
  await addColumnIfMissing(connection, 'affiliate_accounts', 'studio_id', 'INT NULL AFTER id');

  // Studio bank details (so ID admin can transfer to each studio without leaving the app)
  await addColumnIfMissing(connection, 'studios', 'bank_name',           'VARCHAR(150) NULL AFTER name');
  await addColumnIfMissing(connection, 'studios', 'bank_account_holder', 'VARCHAR(200) NULL AFTER bank_name');
  await addColumnIfMissing(connection, 'studios', 'bank_account_number', 'VARCHAR(100) NULL AFTER bank_account_holder');

  // Finance scoping: each finance_staff + finance_periods row belongs to a studio
  // so each studio gets its own P&L (income from Shopee distributions − payroll − expenses).
  await addColumnIfMissing(connection, 'finance_staff',   'studio_id', 'INT NULL AFTER id');
  await addColumnIfMissing(connection, 'finance_periods', 'studio_id', 'INT NULL AFTER id');

  // Tunjangan (allowance): optional fixed monthly stipend in IDR (e.g. transport,
  // health). Added on top of base salary and lunch cashback.
  await addColumnIfMissing(connection, 'finance_staff', 'tunjangan_idr',
    'DECIMAL(15,2) NULL AFTER lunch_cashback_per_day_idr');
  await addColumnIfMissing(connection, 'finance_staff_payouts', 'tunjangan_snapshot_idr',
    'DECIMAL(15,2) NULL AFTER lunch_cashback_snapshot_idr');
  // Swap the unique key from (year, month) -> (studio_id, year, month). Both wrapped
  // in try/catch since they may already be in the desired state.
  try { await connection.query('ALTER TABLE finance_periods DROP INDEX uniq_finance_year_month'); } catch(e) {}
  try { await connection.query('ALTER TABLE finance_periods ADD UNIQUE KEY uniq_finance_studio_year_month (studio_id, year, month)'); } catch(e) {}
  try { await connection.query('ALTER TABLE finance_staff   ADD KEY        idx_finance_staff_studio (studio_id)'); } catch(e) {}

  // Expand role ENUM to include new roles
  try {
    await connection.query(`ALTER TABLE users MODIFY COLUMN role ENUM('superadmin','my_admin','malaysian_admin','indonesia_admin','malaysia_admin','studio') NOT NULL DEFAULT 'studio'`);
  } catch(e) {}

  // Rename old roles to new roles
  try {
    await connection.query(`UPDATE users SET role='indonesia_admin' WHERE role='my_admin'`);
    await connection.query(`UPDATE users SET role='malaysia_admin' WHERE role='malaysian_admin'`);
  } catch(e) {}

  // Update payment_status ENUM to full pipeline
  try {
    await connection.query(`ALTER TABLE payout_entries MODIFY COLUMN payment_status ENUM('processing','collected','transferring','received','distributed','completed') NOT NULL DEFAULT 'processing'`);
    // Migrate old statuses
    await connection.query(`UPDATE payout_entries SET payment_status='processing' WHERE payment_status='pending'`);
    await connection.query(`UPDATE payout_entries SET payment_status='transferring' WHERE payment_status='transferred'`);
    await connection.query(`UPDATE payout_entries SET payment_status='completed' WHERE payment_status='confirmed'`);
  } catch(e) {}

  // Add proof columns
  try {
    await connection.query(`ALTER TABLE payout_entries ADD COLUMN transfer_proof_path VARCHAR(500) NULL AFTER collected_by`);
  } catch(e) {}
  try {
    await connection.query(`ALTER TABLE payout_entries ADD COLUMN distribution_proof_path VARCHAR(500) NULL AFTER transfer_proof_path`);
  } catch(e) {}

  // Seed default settings if empty
  const [settingsRows] = await connection.query('SELECT COUNT(*) AS c FROM settings');
  if (settingsRows[0].c === 0) {
    await connection.query(`INSERT IGNORE INTO settings (\`key\`, \`value\`) VALUES
      ('openai_api_key', ''),
      ('default_deduction_percent', '5.00'),
      ('default_business_profile_id', '1'),
      ('myr_to_idr_rate', '3600'),
      ('idr_to_myr_rate', '0.000278')`);
  }

  // Seed default business profile if empty
  const [bpRows] = await connection.query('SELECT COUNT(*) AS c FROM business_profiles');
  if (bpRows[0].c === 0) {
    await connection.query(`INSERT INTO business_profiles (name, address, email, is_default)
      VALUES ('Indosofthouse', 'Malaysia / Indonesia', 'admin@indosofthouse.com', 1)`);
  }

  await connection.end();
  console.log('✓ Database synced (all tables ready)');
}

module.exports = { syncDatabase };

-- ISH Invoice System — Seed Data
USE ish_invoice;

-- Default settings
INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('openai_api_key', ''),
  ('default_deduction_percent', '5.00'),
  ('default_business_profile_id', '1');

-- Default ISH business profile
INSERT IGNORE INTO business_profiles (id, name, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default) VALUES
  (1, 'Indosofthouse', 'Malaysia / Indonesia', 'admin@indosofthouse.com', '', 'Bank Transfer', '', 'Indosofthouse', 1);

-- Default superadmin (password: admin123)
INSERT IGNORE INTO users (id, name, email, password_hash, role) VALUES
  (1, 'Super Admin', 'superadmin@indosofthouse.com', '$2b$10$/IaJPRCrtP6tS1EiyU.Tp.1hTsQcZyDSwlKkbNg.zTcdMOuc/Bxra', 'superadmin');

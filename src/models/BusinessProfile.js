const db = require('../config/database');

const BusinessProfile = {
  async findAll() {
    const [rows] = await db.query('SELECT * FROM business_profiles ORDER BY is_default DESC, name');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM business_profiles WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findDefault() {
    const [rows] = await db.query('SELECT * FROM business_profiles WHERE is_default = 1 LIMIT 1');
    return rows[0] || null;
  },

  async create({ name, logo_path, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default }) {
    if (is_default) await db.query('UPDATE business_profiles SET is_default = 0');
    const [result] = await db.query(
      `INSERT INTO business_profiles (name, logo_path, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, logo_path || null, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default ? 1 : 0]
    );
    return result.insertId;
  },

  async update(id, { name, logo_path, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default }) {
    if (is_default) await db.query('UPDATE business_profiles SET is_default = 0 WHERE id != ?', [id]);
    await db.query(
      `UPDATE business_profiles SET name=?, logo_path=?, address=?, email=?, phone=?,
       bank_name=?, bank_account_number=?, bank_account_name=?, is_default=? WHERE id=?`,
      [name, logo_path || null, address, email, phone, bank_name, bank_account_number, bank_account_name, is_default ? 1 : 0, id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM business_profiles WHERE id=?', [id]);
  }
};

module.exports = BusinessProfile;

const db = require('../config/database');

const Affiliate = {
  async findAll() {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts ORDER BY full_name');
    return rows;
  },

  async findActive() {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE is_active=1 ORDER BY full_name');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE id=?', [id]);
    return rows[0] || null;
  },

  async findByName(name) {
    // Case-insensitive exact match first
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE LOWER(full_name) = LOWER(?) AND is_active=1 LIMIT 1', [name]);
    return rows[0] || null;
  },

  async create({ full_name, bank_name, account_number, phone, notes }) {
    const [result] = await db.query(
      'INSERT INTO affiliate_accounts (full_name, bank_name, account_number, phone, notes) VALUES (?,?,?,?,?)',
      [full_name, bank_name, account_number, phone || null, notes || null]
    );
    return result.insertId;
  },

  async update(id, { full_name, bank_name, account_number, phone, notes, is_active }) {
    await db.query(
      'UPDATE affiliate_accounts SET full_name=?, bank_name=?, account_number=?, phone=?, notes=?, is_active=? WHERE id=?',
      [full_name, bank_name, account_number, phone || null, notes || null, is_active, id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM affiliate_accounts WHERE id=?', [id]);
  }
};

module.exports = Affiliate;

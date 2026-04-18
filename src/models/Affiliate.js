const db = require('../config/database');

const Affiliate = {
  async findAll() {
    const [rows] = await db.query(
      `SELECT a.*, s.name AS studio_name FROM affiliate_accounts a
       LEFT JOIN studios s ON a.studio_id = s.id
       ORDER BY a.full_name`
    );
    return rows;
  },

  async findActive() {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE is_active=1 ORDER BY full_name');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT a.*, s.name AS studio_name FROM affiliate_accounts a
       LEFT JOIN studios s ON a.studio_id = s.id
       WHERE a.id=?`, [id]);
    return rows[0] || null;
  },

  async findByName(name) {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE LOWER(full_name) = LOWER(?) AND is_active=1 LIMIT 1', [name]);
    return rows[0] || null;
  },

  async findByNameAndStudio(name, studioId) {
    const [rows] = await db.query('SELECT * FROM affiliate_accounts WHERE LOWER(full_name) = LOWER(?) AND studio_id=? AND is_active=1 LIMIT 1', [name, studioId]);
    return rows[0] || null;
  },

  async findByStudio(studioId) {
    const [rows] = await db.query(
      `SELECT a.*, s.name AS studio_name FROM affiliate_accounts a
       LEFT JOIN studios s ON a.studio_id = s.id
       WHERE a.studio_id=? ORDER BY a.full_name`, [studioId]);
    return rows;
  },

  async create({ full_name, bank_name, account_number, phone, notes, studio_id }) {
    const [result] = await db.query(
      'INSERT INTO affiliate_accounts (full_name, bank_name, account_number, phone, notes, studio_id) VALUES (?,?,?,?,?,?)',
      [full_name, bank_name, account_number, phone || null, notes || null, studio_id || null]
    );
    return result.insertId;
  },

  async update(id, { full_name, bank_name, account_number, phone, notes, is_active, studio_id }) {
    await db.query(
      'UPDATE affiliate_accounts SET full_name=?, bank_name=?, account_number=?, phone=?, notes=?, is_active=?, studio_id=? WHERE id=?',
      [full_name, bank_name, account_number, phone || null, notes || null, is_active, studio_id || null, id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM affiliate_accounts WHERE id=?', [id]);
  }
};

module.exports = Affiliate;

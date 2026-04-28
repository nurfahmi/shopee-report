const db = require('../config/database');

const Studio = {
  async findAll() {
    const [rows] = await db.query('SELECT * FROM studios ORDER BY name');
    return rows;
  },

  // Per-studio aggregates for the management page.
  async findAllWithStats() {
    const [rows] = await db.query(`
      SELECT
        s.id, s.name, s.created_at,
        s.bank_name, s.bank_account_holder, s.bank_account_number,
        COALESCE(aff.cnt, 0)              AS affiliate_count,
        COALESCE(usr.cnt, 0)              AS user_count,
        COALESCE(pay.cnt, 0)              AS payout_count,
        COALESCE(pay.paid_idr, 0)         AS paid_idr,
        COALESCE(pay.pending_myr, 0)      AS pending_myr,
        pay.last_activity_at              AS last_activity_at
      FROM studios s
      LEFT JOIN (
        SELECT studio_id, COUNT(*) AS cnt FROM affiliate_accounts GROUP BY studio_id
      ) aff ON aff.studio_id = s.id
      LEFT JOIN (
        SELECT studio_id, COUNT(*) AS cnt FROM users WHERE role='studio' GROUP BY studio_id
      ) usr ON usr.studio_id = s.id
      LEFT JOIN (
        SELECT a.studio_id,
               COUNT(*) AS cnt,
               SUM(CASE WHEN pe.payment_status IN ('distributed','completed')
                        THEN COALESCE(pe.actual_distributed_idr, 0) ELSE 0 END) AS paid_idr,
               SUM(CASE WHEN pe.payment_status NOT IN ('distributed','completed')
                        THEN pe.payout_amount ELSE 0 END) AS pending_myr,
               MAX(pe.updated_at) AS last_activity_at
        FROM payout_entries pe
        LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
        WHERE a.studio_id IS NOT NULL
        GROUP BY a.studio_id
      ) pay ON pay.studio_id = s.id
      ORDER BY s.name
    `);
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM studios WHERE id=?', [id]);
    return rows[0] || null;
  },

  async create({ name, bank_name = null, bank_account_holder = null, bank_account_number = null }) {
    const [result] = await db.query(
      `INSERT INTO studios (name, bank_name, bank_account_holder, bank_account_number)
       VALUES (?, ?, ?, ?)`,
      [name, bank_name || null, bank_account_holder || null, bank_account_number || null]
    );
    return result.insertId;
  },

  async update(id, { name, bank_name = null, bank_account_holder = null, bank_account_number = null }) {
    await db.query(
      `UPDATE studios SET name=?, bank_name=?, bank_account_holder=?, bank_account_number=? WHERE id=?`,
      [name, bank_name || null, bank_account_holder || null, bank_account_number || null, id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM studios WHERE id=?', [id]);
  }
};

module.exports = Studio;

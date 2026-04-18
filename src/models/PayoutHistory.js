const db = require('../config/database');

const PayoutHistory = {
  async log({ payout_period_id, payout_entry_id, action, details, performed_by }) {
    await db.query(
      `INSERT INTO payout_history (payout_period_id, payout_entry_id, action, details, performed_by)
       VALUES (?,?,?,?,?)`,
      [payout_period_id, payout_entry_id || null, action, details || null, performed_by]
    );
  },

  async findByPeriod(payout_period_id) {
    const [rows] = await db.query(
      `SELECT ph.*, u.name AS performed_by_name
       FROM payout_history ph
       LEFT JOIN users u ON ph.performed_by = u.id
       WHERE ph.payout_period_id = ?
       ORDER BY ph.created_at DESC`,
      [payout_period_id]
    );
    return rows;
  },

  async findAll(limit = 50) {
    const [rows] = await db.query(
      `SELECT ph.*, u.name AS performed_by_name, pp.period_label
       FROM payout_history ph
       LEFT JOIN users u ON ph.performed_by = u.id
       LEFT JOIN payout_periods pp ON ph.payout_period_id = pp.id
       ORDER BY ph.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows;
  }
};

module.exports = PayoutHistory;

const db = require('../config/database');

const PayoutPeriod = {
  async findAll() {
    const [rows] = await db.query(
      `SELECT pp.*, u.name AS created_by_name
       FROM payout_periods pp
       LEFT JOIN users u ON pp.created_by = u.id
       ORDER BY pp.payout_date DESC, pp.id DESC`
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT pp.*, u.name AS created_by_name
       FROM payout_periods pp
       LEFT JOIN users u ON pp.created_by = u.id
       WHERE pp.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async nextNumber() {
    const year = new Date().getFullYear();
    const prefix = `ISH-PAY-${year}-`;
    const [rows] = await db.query(
      'SELECT period_number FROM payout_periods WHERE period_number LIKE ? ORDER BY id DESC LIMIT 1',
      [`${prefix}%`]
    );
    if (!rows.length) return `${prefix}001`;
    const last = parseInt(rows[0].period_number.split('-').pop(), 10);
    return `${prefix}${String(last + 1).padStart(3, '0')}`;
  },

  async create({ period_label, payout_date, shopee_invoice_path, deduction_percent, created_by }) {
    const period_number = await PayoutPeriod.nextNumber();
    const [result] = await db.query(
      `INSERT INTO payout_periods
       (period_number, period_label, payout_date, shopee_invoice_path, deduction_percent, created_by)
       VALUES (?,?,?,?,?,?)`,
      [period_number, period_label, payout_date, shopee_invoice_path || null, deduction_percent || null, created_by]
    );
    return { id: result.insertId, period_number };
  },

  async updateTotals(id, { total_gross, deduction_percent, deduction_amount, net_to_ish }) {
    await db.query(
      'UPDATE payout_periods SET total_gross=?, deduction_percent=?, deduction_amount=?, net_to_ish=? WHERE id=?',
      [total_gross, deduction_percent, deduction_amount, net_to_ish, id]
    );
  },

  async updateStatus(id, status, extra = {}) {
    const fields = ['status = ?'];
    const values = [status];
    if (extra.settled_by)   { fields.push('settled_by = ?');   values.push(extra.settled_by); }
    if (extra.confirmed_by) { fields.push('confirmed_by = ?'); values.push(extra.confirmed_by); }
    if (extra.transfer_proof_path) { fields.push('transfer_proof_path = ?'); values.push(extra.transfer_proof_path); }
    if (extra.transfer_date) { fields.push('transfer_date = ?'); values.push(extra.transfer_date); }
    values.push(id);
    await db.query(`UPDATE payout_periods SET ${fields.join(', ')} WHERE id = ?`, values);
  },

  async updateInvoicePath(id, path) {
    await db.query('UPDATE payout_periods SET shopee_invoice_path=? WHERE id=?', [path, id]);
  },

  async delete(id) {
    await db.query('DELETE FROM payout_periods WHERE id=?', [id]);
  }
};

module.exports = PayoutPeriod;

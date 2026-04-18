const db = require('../config/database');

const PayoutEntry = {
  async findAll({ limit = 100, offset = 0, studioId = null } = {}) {
    let where = '';
    const params = [];
    if (studioId) {
      where = 'WHERE a.studio_id = ?';
      params.push(studioId);
    }
    params.push(limit, offset);
    const [rows] = await db.query(
      `SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number, a.studio_id,
              s.name AS studio_name, u.name AS created_by_name
       FROM payout_entries pe
       LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
       LEFT JOIN studios s ON a.studio_id = s.id
       LEFT JOIN users u ON pe.created_by = u.id
       ${where}
       ORDER BY pe.invoice_date DESC, pe.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number, a.studio_id,
              s.name AS studio_name
       FROM payout_entries pe
       LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
       LEFT JOIN studios s ON a.studio_id = s.id
       WHERE pe.id=?`, [id]);
    return rows[0] || null;
  },

  async create({ affiliate_account_id, extracted_name, invoice_number, invoice_file_path, invoice_date, period_description, payout_amount, tax_amount, payout_amount_idr, created_by }) {
    const [result] = await db.query(
      `INSERT INTO payout_entries (affiliate_account_id, extracted_name, invoice_number, invoice_file_path, invoice_date, period_description, payout_amount, tax_amount, payout_amount_idr, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [affiliate_account_id || null, extracted_name || null, invoice_number || null, invoice_file_path || null, invoice_date || null, period_description || null, payout_amount || 0, tax_amount || 0, payout_amount_idr || 0, created_by || null]
    );
    return result.insertId;
  },

  async findByInvoiceNumber(invoiceNumber) {
    const [rows] = await db.query('SELECT id FROM payout_entries WHERE invoice_number = ? LIMIT 1', [invoiceNumber]);
    return rows[0] || null;
  },

  async updateStatus(id, status, userId) {
    if (status === 'collected') {
      await db.query(`UPDATE payout_entries SET payment_status='collected', payment_time=NOW(), collected_by=? WHERE id=?`, [userId, id]);
    } else {
      await db.query(`UPDATE payout_entries SET payment_status=? WHERE id=?`, [status, id]);
    }
  },

  async markCollected(id, collected_by) {
    await this.updateStatus(id, 'collected', collected_by);
  },

  async deleteById(id) {
    await db.query('DELETE FROM payout_entries WHERE id=?', [id]);
  },

  async getStats({ studioId = null } = {}) {
    let join = '';
    let where = '';
    const params = [];
    if (studioId) {
      join = 'LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id';
      where = 'WHERE a.studio_id = ?';
      params.push(studioId);
    }
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total_entries,
        COALESCE(SUM(pe.payout_amount), 0) AS total_myr,
        COALESCE(SUM(pe.payout_amount_idr), 0) AS total_idr,
        SUM(CASE WHEN pe.payment_status='processing' THEN 1 ELSE 0 END) AS processing_count,
        COALESCE(SUM(CASE WHEN pe.payment_status='processing' THEN pe.payout_amount ELSE 0 END), 0) AS processing_myr,
        SUM(CASE WHEN pe.payment_status='pending' THEN 1 ELSE 0 END) AS pending_count,
        COALESCE(SUM(CASE WHEN pe.payment_status='pending' THEN pe.payout_amount ELSE 0 END), 0) AS pending_myr,
        SUM(CASE WHEN pe.payment_status='collected' THEN 1 ELSE 0 END) AS collected_count,
        COALESCE(SUM(CASE WHEN pe.payment_status='collected' THEN pe.payout_amount ELSE 0 END), 0) AS collected_myr
      FROM payout_entries pe
      ${join}
      ${where}
    `, params);
    return rows[0];
  }
};

module.exports = PayoutEntry;

const db = require('../config/database');

const Invoice = {
  async findAll() {
    const [rows] = await db.query(
      `SELECT i.*, p.project_name, c.name AS client_name, c.company, bp.name AS business_name
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN business_profiles bp ON i.business_profile_id = bp.id
       ORDER BY i.created_at DESC`
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT i.*, p.project_name, p.description AS project_description,
              c.name AS client_name, c.company, c.email AS client_email,
              c.phone AS client_phone, c.address AS client_address, c.currency,
              bp.name AS business_name, bp.logo_path, bp.address AS business_address,
              bp.email AS business_email, bp.phone AS business_phone,
              bp.bank_name, bp.bank_account_number, bp.bank_account_name
       FROM invoices i
       LEFT JOIN projects p ON i.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN business_profiles bp ON i.business_profile_id = bp.id
       WHERE i.id = ?`,
      [id]
    );
    return rows[0] || null;
  },

  async nextNumber() {
    const year = new Date().getFullYear();
    const prefix = `ISH-INV-${year}-`;
    const [rows] = await db.query(
      'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1',
      [`${prefix}%`]
    );
    if (!rows.length) return `${prefix}001`;
    const last = parseInt(rows[0].invoice_number.split('-').pop(), 10);
    return `${prefix}${String(last + 1).padStart(3, '0')}`;
  },

  async create({ project_id, business_profile_id, issue_date, due_date, payment_type, subtotal, tax_percent, tax_amount, total, notes }) {
    const invoice_number = await Invoice.nextNumber();
    const balance_due = total;
    const [result] = await db.query(
      `INSERT INTO invoices
       (project_id, business_profile_id, invoice_number, issue_date, due_date, payment_type,
        subtotal, tax_percent, tax_amount, total, balance_due, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [project_id, business_profile_id, invoice_number, issue_date, due_date || null, payment_type,
       subtotal, tax_percent, tax_amount, total, balance_due, notes || null]
    );
    return { id: result.insertId, invoice_number };
  },

  async update(id, { business_profile_id, issue_date, due_date, payment_type, subtotal, tax_percent, tax_amount, total, notes }) {
    await db.query(
      `UPDATE invoices SET business_profile_id=?, issue_date=?, due_date=?, payment_type=?,
       subtotal=?, tax_percent=?, tax_amount=?, total=?, notes=? WHERE id=?`,
      [business_profile_id, issue_date, due_date || null, payment_type, subtotal, tax_percent, tax_amount, total, notes || null, id]
    );
  },

  async recalcBalance(id) {
    const [rows] = await db.query(
      'SELECT total, COALESCE(SUM(p.amount),0) AS paid FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id WHERE i.id=? GROUP BY i.id',
      [id]
    );
    if (!rows.length) return;
    const { total, paid } = rows[0];
    const balance = parseFloat(total) - parseFloat(paid);
    const status = parseFloat(paid) <= 0 ? 'sent'
      : balance <= 0 ? 'paid'
      : 'partial';
    await db.query(
      'UPDATE invoices SET amount_paid=?, balance_due=?, status=? WHERE id=?',
      [paid, balance < 0 ? 0 : balance, status, id]
    );
  },

  async updateStatus(id, status) {
    await db.query('UPDATE invoices SET status=? WHERE id=?', [status, id]);
  },

  async delete(id) {
    await db.query('DELETE FROM invoices WHERE id=?', [id]);
  }
};

module.exports = Invoice;

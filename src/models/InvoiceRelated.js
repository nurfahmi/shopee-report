const db = require('../config/database');

const InvoiceItem = {
  async findByInvoice(invoice_id) {
    const [rows] = await db.query(
      'SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order, id',
      [invoice_id]
    );
    return rows;
  },

  async bulkReplace(invoice_id, items) {
    await db.query('DELETE FROM invoice_items WHERE invoice_id=?', [invoice_id]);
    for (let i = 0; i < items.length; i++) {
      const { phase_label, description, quantity, unit_price, amount } = items[i];
      await db.query(
        'INSERT INTO invoice_items (invoice_id, phase_label, description, quantity, unit_price, amount, sort_order) VALUES (?,?,?,?,?,?,?)',
        [invoice_id, phase_label || null, description, quantity, unit_price, amount, i]
      );
    }
  }
};

const InvoiceMilestone = {
  async findByInvoice(invoice_id) {
    const [rows] = await db.query(
      'SELECT * FROM invoice_milestones WHERE invoice_id=? ORDER BY id',
      [invoice_id]
    );
    return rows;
  },

  async bulkReplace(invoice_id, milestones) {
    await db.query('DELETE FROM invoice_milestones WHERE invoice_id=?', [invoice_id]);
    for (const m of milestones) {
      await db.query(
        'INSERT INTO invoice_milestones (invoice_id, label, percent, amount, due_date) VALUES (?,?,?,?,?)',
        [invoice_id, m.label, m.percent, m.amount, m.due_date || null]
      );
    }
  },

  async markPaid(id) {
    await db.query("UPDATE invoice_milestones SET status='paid', paid_at=NOW() WHERE id=?", [id]);
  }
};

const Payment = {
  async findByInvoice(invoice_id) {
    const [rows] = await db.query(
      'SELECT * FROM payments WHERE invoice_id=? ORDER BY payment_date DESC',
      [invoice_id]
    );
    return rows;
  },

  async create({ invoice_id, milestone_id, amount, payment_date, method, reference, notes }) {
    const [result] = await db.query(
      'INSERT INTO payments (invoice_id, milestone_id, amount, payment_date, method, reference, notes) VALUES (?,?,?,?,?,?,?)',
      [invoice_id, milestone_id || null, amount, payment_date, method || null, reference || null, notes || null]
    );
    return result.insertId;
  },

  async delete(id) {
    await db.query('DELETE FROM payments WHERE id=?', [id]);
  }
};

module.exports = { InvoiceItem, InvoiceMilestone, Payment };

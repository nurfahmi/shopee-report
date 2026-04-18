const db = require('../config/database');

const Client = {
  async findAll() {
    const [rows] = await db.query('SELECT * FROM clients ORDER BY name');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM clients WHERE id=?', [id]);
    return rows[0] || null;
  },

  async create({ name, company, email, phone, address, country, currency }) {
    const [result] = await db.query(
      'INSERT INTO clients (name, company, email, phone, address, country, currency) VALUES (?,?,?,?,?,?,?)',
      [name, company || null, email || null, phone || null, address || null, country || 'Malaysia', currency || 'MYR']
    );
    return result.insertId;
  },

  async update(id, { name, company, email, phone, address, country, currency }) {
    await db.query(
      'UPDATE clients SET name=?, company=?, email=?, phone=?, address=?, country=?, currency=? WHERE id=?',
      [name, company || null, email || null, phone || null, address || null, country || 'Malaysia', currency || 'MYR', id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM clients WHERE id=?', [id]);
  }
};

module.exports = Client;

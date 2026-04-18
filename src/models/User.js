const db = require('../config/database');
const bcrypt = require('bcryptjs');

const User = {
  async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async findAll() {
    const [rows] = await db.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY role, name'
    );
    return rows;
  },

  async create({ name, email, password, role, created_by }) {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, email, hash, role, created_by]
    );
    return result.insertId;
  },

  async update(id, { name, email, role, is_active }) {
    await db.query(
      'UPDATE users SET name=?, email=?, role=?, is_active=? WHERE id=?',
      [name, email, role, is_active, id]
    );
  },

  async updatePassword(id, password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=? WHERE id=?', [hash, id]);
  },

  async delete(id) {
    await db.query('DELETE FROM users WHERE id=?', [id]);
  },

  async verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  }
};

module.exports = User;

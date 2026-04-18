const db = require('../config/database');
const bcrypt = require('bcryptjs');

const User = {
  async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.studio_id, u.is_active, u.created_at, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON u.studio_id = s.id WHERE u.id = ?`, [id]);
    return rows[0] || null;
  },

  async findAll() {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.studio_id, u.is_active, u.created_at, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON u.studio_id = s.id ORDER BY u.role, u.name`
    );
    return rows;
  },

  async create({ name, email, password, role, studio_id, created_by }) {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password_hash, role, studio_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hash, role, studio_id || null, created_by]
    );
    return result.insertId;
  },

  async update(id, { name, email, role, is_active, studio_id }) {
    await db.query(
      'UPDATE users SET name=?, email=?, role=?, is_active=?, studio_id=? WHERE id=?',
      [name, email, role, is_active, studio_id || null, id]
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

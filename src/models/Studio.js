const db = require('../config/database');

const Studio = {
  async findAll() {
    const [rows] = await db.query('SELECT * FROM studios ORDER BY name');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM studios WHERE id=?', [id]);
    return rows[0] || null;
  },

  async create({ name }) {
    const [result] = await db.query('INSERT INTO studios (name) VALUES (?)', [name]);
    return result.insertId;
  },

  async update(id, { name }) {
    await db.query('UPDATE studios SET name=? WHERE id=?', [name, id]);
  },

  async delete(id) {
    await db.query('DELETE FROM studios WHERE id=?', [id]);
  }
};

module.exports = Studio;

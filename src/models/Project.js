const db = require('../config/database');

const Project = {
  async findAll() {
    const [rows] = await db.query(
      `SELECT p.*, c.name AS client_name, c.company FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       ORDER BY p.created_at DESC`
    );
    return rows;
  },

  async findByClient(client_id) {
    const [rows] = await db.query('SELECT * FROM projects WHERE client_id=? ORDER BY created_at DESC', [client_id]);
    return rows;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT p.*, c.name AS client_name, c.company, c.email AS client_email, c.currency
       FROM projects p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id=?`,
      [id]
    );
    return rows[0] || null;
  },

  async create({ client_id, project_name, description, scope_md_path }) {
    const [result] = await db.query(
      'INSERT INTO projects (client_id, project_name, description, scope_md_path) VALUES (?,?,?,?)',
      [client_id, project_name, description || null, scope_md_path || null]
    );
    return result.insertId;
  },

  async update(id, { project_name, description, scope_md_path, status }) {
    await db.query(
      'UPDATE projects SET project_name=?, description=?, scope_md_path=?, status=? WHERE id=?',
      [project_name, description || null, scope_md_path || null, status || 'active', id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM projects WHERE id=?', [id]);
  }
};

module.exports = Project;

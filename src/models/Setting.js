const db = require('../config/database');

const Setting = {
  async get(key) {
    const [rows] = await db.query('SELECT `value` FROM settings WHERE `key` = ?', [key]);
    return rows[0]?.value ?? null;
  },

  async getMeta(key) {
    const [rows] = await db.query('SELECT `value`, updated_at FROM settings WHERE `key` = ?', [key]);
    return rows[0] || null;
  },

  async getAll() {
    const [rows] = await db.query('SELECT `key`, `value` FROM settings');
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    return map;
  },

  async set(key, value) {
    await db.query(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
      [key, value, value]
    );
  },

  async setMultiple(obj) {
    for (const [key, value] of Object.entries(obj)) {
      await Setting.set(key, value);
    }
  }
};

module.exports = Setting;

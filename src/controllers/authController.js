const User = require('../models/User');
const db = require('../config/database');

const authController = {
  getLogin(req, res) {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('auth/login', { title: 'Login — Shopee Report', layout: false });
  },

  async postLogin(req, res) {
    const { email, password } = req.body;
    try {
      const user = await User.findByEmail(email);
      if (!user || !user.is_active) {
        req.flash('error', 'Invalid credentials or account disabled.');
        return res.redirect('/auth/login');
      }
      const match = await User.verifyPassword(password, user.password_hash);
      if (!match) {
        req.flash('error', 'Invalid credentials.');
        return res.redirect('/auth/login');
      }
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, studio_id: user.studio_id || null };
      req.session.save(() => res.redirect('/dashboard'));
    } catch (err) {
      console.error(err);
      req.flash('error', 'Login error. Please try again.');
      res.redirect('/auth/login');
    }
  },

  logout(req, res) {
    req.session.destroy(() => res.redirect('/auth/login'));
  },

  // ── First-time Setup ───────────────────────────────────────────
  async getSetup(req, res) {
    const [rows] = await db.query('SELECT COUNT(*) AS c FROM users');
    if (rows[0].c > 0) return res.redirect('/auth/login');
    res.render('auth/setup', { title: 'Setup', layout: false });
  },

  async postSetup(req, res) {
    const [rows] = await db.query('SELECT COUNT(*) AS c FROM users');
    if (rows[0].c > 0) return res.redirect('/auth/login');

    const { name, email, password, password_confirm } = req.body;

    if (!name || !email || !password) {
      return res.render('auth/setup', { title: 'Setup', layout: false, error: 'All fields are required.', name, email });
    }
    if (password.length < 6) {
      return res.render('auth/setup', { title: 'Setup', layout: false, error: 'Password must be at least 6 characters.', name, email });
    }
    if (password !== password_confirm) {
      return res.render('auth/setup', { title: 'Setup', layout: false, error: 'Passwords do not match.', name, email });
    }

    try {
      const insertId = await User.create({ name, email, password, role: 'superadmin', created_by: null });
      req.session.user = { id: insertId, name, email, role: 'superadmin', studio_id: null };
      req.session.save(() => res.redirect('/dashboard'));
    } catch (err) {
      console.error('Setup error:', err);
      res.render('auth/setup', { title: 'Setup', layout: false, error: err.message, name, email });
    }
  },

  // ── Impersonate (superadmin only) ──────────────────────────────
  async impersonate(req, res) {
    if (req.session.user.role !== 'superadmin') return res.redirect('/dashboard');

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      req.flash('error', 'User not found.');
      return res.redirect('/users');
    }

    req.session.originalUser = req.session.user;
    req.session.user = { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role, studio_id: targetUser.studio_id || null };
    req.session.save(() => {
      req.flash('success', `Now impersonating: ${targetUser.name} (${targetUser.role.replace('_', ' ')})`);
      res.redirect('/dashboard');
    });
  },

  // ── Stop impersonating ─────────────────────────────────────────
  stopImpersonate(req, res) {
    if (req.session.originalUser) {
      req.session.user = req.session.originalUser;
      delete req.session.originalUser;
      req.session.save(() => {
        req.flash('success', 'Switched back to your account.');
        res.redirect('/dashboard');
      });
    } else {
      res.redirect('/dashboard');
    }
  }
};

module.exports = authController;

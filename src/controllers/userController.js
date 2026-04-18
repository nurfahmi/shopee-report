const User = require('../models/User');

const userController = {
  async index(req, res) {
    const users = await User.findAll();
    res.render('users/index', { title: 'User Management', users, user: req.session.user });
  },

  getCreate(req, res) {
    res.render('users/form', { title: 'Create User', editing: false, data: {}, user: req.session.user });
  },

  async postCreate(req, res) {
    const { name, email, password, role } = req.body;
    try {
      await User.create({ name, email, password, role, created_by: req.session.user.id });
      req.flash('success', 'User created successfully.');
      res.redirect('/users');
    } catch (err) {
      req.flash('error', err.message.includes('Duplicate') ? 'Email already exists.' : err.message);
      res.render('users/form', { title: 'Create User', editing: false, data: req.body, user: req.session.user });
    }
  },

  async getEdit(req, res) {
    const data = await User.findById(req.params.id);
    if (!data) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    res.render('users/form', { title: 'Edit User', editing: true, data, user: req.session.user });
  },

  async postEdit(req, res) {
    const { name, email, role, is_active, new_password } = req.body;
    const id = req.params.id;
    // Protect: cannot downgrade or delete own superadmin if last one
    try {
      await User.update(id, { name, email, role, is_active: is_active === '1' ? 1 : 0 });
      if (new_password && new_password.length >= 6) {
        await User.updatePassword(id, new_password);
      }
      req.flash('success', 'User updated successfully.');
      res.redirect('/users');
    } catch (err) {
      req.flash('error', err.message);
      res.redirect(`/users/${id}/edit`);
    }
  },

  async postDelete(req, res) {
    const id = parseInt(req.params.id);
    if (id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/users');
    }
    await User.delete(id);
    req.flash('success', 'User deleted.');
    res.redirect('/users');
  }
};

module.exports = userController;

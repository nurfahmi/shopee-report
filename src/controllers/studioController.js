const Studio = require('../models/Studio');

const studioController = {
  async index(req, res) {
    const studios = await Studio.findAll();
    res.render('studios/index', { title: 'Studios', studios, user: req.session.user });
  },

  getCreate(req, res) {
    res.render('studios/form', { title: 'Create Studio', editing: false, data: {}, user: req.session.user });
  },

  async postCreate(req, res) {
    await Studio.create({ name: req.body.name });
    req.flash('success', 'Studio created.');
    res.redirect('/studios');
  },

  async getEdit(req, res) {
    const data = await Studio.findById(req.params.id);
    if (!data) { req.flash('error', 'Not found.'); return res.redirect('/studios'); }
    res.render('studios/form', { title: 'Edit Studio', editing: true, data, user: req.session.user });
  },

  async postEdit(req, res) {
    await Studio.update(req.params.id, { name: req.body.name });
    req.flash('success', 'Studio updated.');
    res.redirect('/studios');
  },

  async postDelete(req, res) {
    await Studio.delete(req.params.id);
    req.flash('success', 'Studio deleted.');
    res.redirect('/studios');
  }
};

module.exports = studioController;

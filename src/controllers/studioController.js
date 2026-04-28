const Studio = require('../models/Studio');

const studioController = {
  async index(req, res) {
    const studios = await Studio.findAllWithStats();
    const totals = studios.reduce((t, s) => ({
      affiliates: t.affiliates + parseInt(s.affiliate_count || 0),
      users:      t.users      + parseInt(s.user_count || 0),
      payouts:    t.payouts    + parseInt(s.payout_count || 0),
      paidIdr:    t.paidIdr    + parseFloat(s.paid_idr || 0),
      pendingMyr: t.pendingMyr + parseFloat(s.pending_myr || 0),
    }), { affiliates: 0, users: 0, payouts: 0, paidIdr: 0, pendingMyr: 0 });
    res.render('studios/index', { title: 'Studios', studios, totals, user: req.session.user });
  },

  getCreate(req, res) {
    res.render('studios/form', { title: 'Create Studio', editing: false, data: {}, user: req.session.user });
  },

  async postCreate(req, res) {
    const { name, bank_name, bank_account_holder, bank_account_number } = req.body;
    await Studio.create({ name, bank_name, bank_account_holder, bank_account_number });
    req.flash('success', 'Studio created.');
    res.redirect('/studios');
  },

  async getEdit(req, res) {
    const data = await Studio.findById(req.params.id);
    if (!data) { req.flash('error', 'Not found.'); return res.redirect('/studios'); }
    res.render('studios/form', { title: 'Edit Studio', editing: true, data, user: req.session.user });
  },

  async postEdit(req, res) {
    const { name, bank_name, bank_account_holder, bank_account_number } = req.body;
    await Studio.update(req.params.id, { name, bank_name, bank_account_holder, bank_account_number });
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

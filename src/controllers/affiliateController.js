const Affiliate = require('../models/Affiliate');

const affiliateController = {
  async index(req, res) {
    const affiliates = await Affiliate.findAll();
    res.render('shopee/affiliates/index', { title: 'Affiliate Accounts', affiliates, user: req.session.user });
  },

  getCreate(req, res) {
    res.render('shopee/affiliates/form', { title: 'Add Affiliate', editing: false, data: {}, user: req.session.user });
  },

  async postCreate(req, res) {
    const { full_name, bank_name, account_number, phone, notes } = req.body;
    await Affiliate.create({ full_name, bank_name, account_number, phone, notes });
    req.flash('success', 'Affiliate account added.');
    res.redirect('/shopee/affiliates');
  },

  async getEdit(req, res) {
    const data = await Affiliate.findById(req.params.id);
    if (!data) { req.flash('error', 'Not found.'); return res.redirect('/shopee/affiliates'); }
    res.render('shopee/affiliates/form', { title: 'Edit Affiliate', editing: true, data, user: req.session.user });
  },

  async postEdit(req, res) {
    const { full_name, bank_name, account_number, phone, notes, is_active } = req.body;
    await Affiliate.update(req.params.id, { full_name, bank_name, account_number, phone, notes, is_active: is_active === '1' ? 1 : 0 });
    req.flash('success', 'Affiliate updated.');
    res.redirect('/shopee/affiliates');
  },

  async postDelete(req, res) {
    await Affiliate.delete(req.params.id);
    req.flash('success', 'Affiliate deleted.');
    res.redirect('/shopee/affiliates');
  }
};

module.exports = affiliateController;

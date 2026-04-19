const Affiliate = require('../models/Affiliate');
const Studio = require('../models/Studio');
const Setting = require('../models/Setting');
const { extractBankStatement } = require('../services/ocrService');

const affiliateController = {
  async index(req, res) {
    const user = req.session.user;
    const studioId = user.role === 'studio' ? user.studio_id : null;
    const affiliates = studioId ? await Affiliate.findByStudio(studioId) : await Affiliate.findAll();
    const studios = await Studio.findAll();
    const rate = parseFloat(await Setting.get('myr_to_idr_rate')) || 3600;
    res.render('shopee/affiliates/index', { title: 'Affiliate Accounts', affiliates, studios, rate, user });
  },

  async postUploadStatement(req, res) {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/shopee/affiliates');
    }
    try {
      const result = await extractBankStatement(req.file.path);
      const studios = await Studio.findAll();
      res.render('shopee/affiliates/form', {
        title: 'Add Account from Statement',
        editing: false,
        data: {
          full_name: result.account_holder || '',
          bank_name: result.bank_name || '',
          account_number: result.account_number || '',
        },
        studios,
        extractResult: result,
        user: req.session.user
      });
    } catch (err) {
      req.flash('error', `Failed to extract: ${err.message}`);
      res.redirect('/shopee/affiliates');
    }
  },

  async getCreate(req, res) {
    const studios = await Studio.findAll();
    res.render('shopee/affiliates/form', { title: 'Add Affiliate', editing: false, data: {}, studios, extractResult: null, user: req.session.user });
  },

  async postCreate(req, res) {
    const { full_name, bank_name, account_number, phone, notes, studio_id } = req.body;
    const user = req.session.user;
    const sid = user.role === 'studio' ? user.studio_id : (studio_id || null);
    await Affiliate.create({ full_name, bank_name, account_number, phone, notes, studio_id: sid });
    req.flash('success', 'Affiliate account added.');
    res.redirect('/shopee/affiliates');
  },

  async getEdit(req, res) {
    const data = await Affiliate.findById(req.params.id);
    if (!data) { req.flash('error', 'Not found.'); return res.redirect('/shopee/affiliates'); }
    const user = req.session.user;
    if (user.role === 'studio' && data.studio_id !== user.studio_id) {
      req.flash('error', 'Access denied.'); return res.redirect('/shopee/affiliates');
    }
    const studios = await Studio.findAll();
    res.render('shopee/affiliates/form', { title: 'Edit Affiliate', editing: true, data, studios, extractResult: null, user });
  },

  async postEdit(req, res) {
    const { full_name, bank_name, account_number, phone, notes, is_active, studio_id } = req.body;
    const user = req.session.user;
    const sid = user.role === 'studio' ? user.studio_id : (studio_id || null);
    await Affiliate.update(req.params.id, { full_name, bank_name, account_number, phone, notes, is_active: is_active === '1' ? 1 : 0, studio_id: sid });
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


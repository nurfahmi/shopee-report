const Affiliate = require('../models/Affiliate');
const Studio = require('../models/Studio');
const Setting = require('../models/Setting');
const PayoutEntry = require('../models/PayoutEntry');
const { extractBankStatement } = require('../services/ocrService');
const { breakdownEntry } = require('../services/payoutCalc');

const affiliateController = {
  async index(req, res) {
    const user = req.session.user;
    const studioId = user.role === 'studio' ? user.studio_id : null;
    const affiliates = studioId ? await Affiliate.findByStudio(studioId) : await Affiliate.findAll();
    const studios = await Studio.findAll();
    const rateRow = await Setting.getMeta('myr_to_idr_rate');
    const rate = parseFloat(rateRow?.value) || 3600;
    const rateMeta = { value: rate, updated_at: rateRow?.updated_at || null };

    // Per-affiliate settlement aggregates (commission kept + amount sent to MY admin)
    const allSettings = await Setting.getAll();
    const deductions = {
      general: parseFloat(allSettings.deduction_general_percent || 0),
      myAdmin: parseFloat(allSettings.deduction_my_admin_percent || 0),
      myHQ:    parseFloat(allSettings.deduction_my_hq_percent    || 0),
      idAdmin: parseFloat(allSettings.deduction_id_admin_percent || 0),
    };
    const allEntries = await PayoutEntry.findAll({ studioId, limit: 100000, offset: 0 });
    const SENT_STATUSES = new Set(['collected','transferring','received','distributed','completed']);
    const stats = new Map();
    for (const e of allEntries) {
      if (!e.affiliate_account_id) continue;
      const b = breakdownEntry(e, deductions);
      const sent = b.needToPay;
      const s = stats.get(e.affiliate_account_id) || { count: 0, kept: 0, sent: 0, pending: 0, lastDate: null };
      s.count++;
      s.kept += b.bankHolderShare;
      if (SENT_STATUSES.has(e.payment_status)) s.sent += (e.actual_collected_myr != null ? parseFloat(e.actual_collected_myr) : sent);
      else s.pending += sent;
      if (e.invoice_date && (!s.lastDate || new Date(e.invoice_date) > new Date(s.lastDate))) s.lastDate = e.invoice_date;
      stats.set(e.affiliate_account_id, s);
    }

    const enriched = affiliates.map(a => {
      const s = stats.get(a.id) || { count: 0, kept: 0, sent: 0, pending: 0, lastDate: null };
      return { ...a,
        invoiceCount: s.count,
        holderKeptMyr: s.kept,
        holderSentMyr: s.sent,
        holderPendingMyr: s.pending,
        lastPayoutDate: s.lastDate || a.last_payout_date,
      };
    });

    // Page-level totals for the tfoot
    const totals = enriched.reduce((t, a) => ({
      count:   t.count   + a.invoiceCount,
      kept:    t.kept    + a.holderKeptMyr,
      sent:    t.sent    + a.holderSentMyr,
      pending: t.pending + a.holderPendingMyr,
    }), { count: 0, kept: 0, sent: 0, pending: 0 });

    res.render('shopee/affiliates/index', {
      title: 'Account Details',
      affiliates: enriched, studios, rate, rateMeta, totals, user
    });
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


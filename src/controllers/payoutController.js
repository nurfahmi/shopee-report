const PayoutEntry   = require('../models/PayoutEntry');
const PayoutHistory = require('../models/PayoutHistory');
const Affiliate     = require('../models/Affiliate');
const Setting       = require('../models/Setting');
const { extractMultiplePayouts } = require('../services/ocrService');
const { renderPDF } = require('../services/pdfService');
const fs = require('fs');

async function getRate() {
  return parseFloat(await Setting.get('myr_to_idr_rate')) || 3600;
}

const payoutController = {
  // ── Main page: list all entries ─────────────────────────────────
  async index(req, res) {
    const entries = await PayoutEntry.findAll();
    const stats = await PayoutEntry.getStats();
    const affiliates = await Affiliate.findAll();
    const rate = await getRate();
    res.render('shopee/payouts/index', {
      title: 'Shopee Payouts',
      entries, stats, affiliates, rate,
      user: req.session.user
    });
  },

  // ── Upload Shopee invoices (OCR) ────────────────────────────────
  async postUpload(req, res) {
    const files = req.files || [];
    if (!files.length) {
      req.flash('error', 'No files selected.');
      return res.redirect('/shopee/payouts');
    }

    const rate = await getRate();
    const results = await extractMultiplePayouts(files.map(f => f.path));
    let added = 0;
    let errors = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.error) { errors.push(`${r.file}: ${r.error}`); continue; }

      // Auto-link by name
      let affiliateId = null;
      if (r.supplier_name) {
        const aff = await Affiliate.findByName(r.supplier_name);
        if (aff) affiliateId = aff.id;
      }

      // Parse invoice_date DD/MM/YYYY → YYYY-MM-DD
      let isoDate = null;
      if (r.invoice_date) {
        const p = r.invoice_date.split('/');
        if (p.length === 3) isoDate = `${p[2]}-${p[1]}-${p[0]}`;
      }

      const myr = parseFloat(r.net_payable) || 0;
      await PayoutEntry.create({
        affiliate_account_id: affiliateId,
        extracted_name: r.supplier_name,
        invoice_file_path: `/uploads/shopee-invoices/${files[i].filename}`,
        invoice_date: isoDate,
        period_description: r.period_description || null,
        payout_amount: myr,
        tax_amount: parseFloat(r.tax_amount) || 0,
        payout_amount_idr: Math.round(myr * rate),
        created_by: req.session.user.id
      });
      added++;
    }

    if (errors.length) {
      req.flash('error', `${errors.length} file(s) failed: ${errors.join('; ')}`);
    }
    if (added) {
      req.flash('success', `${added} payout(s) extracted and saved.${added > 0 ? ' Auto-linked to matching accounts.' : ''}`);
    }
    res.redirect('/shopee/payouts');
  },

  // ── Manual entry ────────────────────────────────────────────────
  async postManualEntry(req, res) {
    const { payout_amount, tax_amount, invoice_date, affiliate_account_id, period_description } = req.body;
    const rate = await getRate();
    const myr = parseFloat(payout_amount) || 0;

    // Get affiliate name from selected account
    let name = null;
    if (affiliate_account_id) {
      const aff = await Affiliate.findById(affiliate_account_id);
      if (aff) name = aff.full_name;
    }

    await PayoutEntry.create({
      affiliate_account_id: affiliate_account_id || null,
      extracted_name: name,
      invoice_file_path: null,
      invoice_date: invoice_date || null,
      period_description: period_description || null,
      payout_amount: myr,
      tax_amount: parseFloat(tax_amount) || 0,
      payout_amount_idr: Math.round(myr * rate),
      created_by: req.session.user.id
    });

    req.flash('success', `Entry added: ${name} — MYR ${myr.toFixed(2)}`);
    res.redirect('/shopee/payouts');
  },

  // ── Detail page ─────────────────────────────────────────────────
  async getDetail(req, res) {
    const entry = await PayoutEntry.findById(req.params.id);
    if (!entry) { req.flash('error', 'Entry not found.'); return res.redirect('/shopee/payouts'); }
    const rate = await getRate();
    res.render('shopee/payouts/detail', {
      title: `Payout — ${entry.affiliate_name || entry.extracted_name}`,
      entry, rate, user: req.session.user
    });
  },

  // ── Mark collected (MY admin) ───────────────────────────────────
  async postMarkCollected(req, res) {
    const { id } = req.params;
    await PayoutEntry.markCollected(id, req.session.user.id);
    req.flash('success', 'Marked as collected.');
    res.redirect('/shopee/payouts');
  },

  // ── Delete entry ────────────────────────────────────────────────
  async postDelete(req, res) {
    await PayoutEntry.deleteById(req.params.id);
    req.flash('success', 'Entry deleted.');
    res.redirect('/shopee/payouts');
  },

  // ── Currency converter ──────────────────────────────────────────
  async getConverter(req, res) {
    const rate = await getRate();
    res.render('shopee/converter', { title: 'Currency Converter', myrToIdr: rate, idrToMyr: 1 / rate, user: req.session.user });
  }
};

module.exports = payoutController;

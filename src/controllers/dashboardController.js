const PayoutEntry = require('../models/PayoutEntry');
const Affiliate = require('../models/Affiliate');
const Invoice = require('../models/Invoice');
const Setting = require('../models/Setting');
const db = require('../config/database');

const dashboardController = {
  async index(req, res) {
    try {
      const user = req.session.user;
      const rate = parseFloat(await Setting.get('myr_to_idr_rate')) || 3600;

      // ── Shopee payout stats (entry-centric) ─────────────────────
      const payoutStats = await PayoutEntry.getStats();

      // ── Affiliate count ──────────────────────────────────────────
      const affiliates = await Affiliate.findAll();

      // ── Recent payouts (last 10) ─────────────────────────────────
      const recentPayouts = await PayoutEntry.findAll({ limit: 10 });

      // ── Per-affiliate summary ────────────────────────────────────
      const [affiliateSummary] = await db.query(`
        SELECT
          COALESCE(a.full_name, pe.extracted_name) AS name,
          COUNT(*) AS entry_count,
          COALESCE(SUM(pe.payout_amount), 0) AS total_myr,
          SUM(CASE WHEN pe.payment_status='pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN pe.payment_status='collected' THEN 1 ELSE 0 END) AS collected_count
        FROM payout_entries pe
        LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
        GROUP BY COALESCE(a.full_name, pe.extracted_name)
        ORDER BY total_myr DESC
        LIMIT 10
      `);

      // ── Invoice stats (ISH admins only) ──────────────────────────
      let invoiceStats = null;
      if (user.role !== 'malaysian_admin') {
        try {
          const [invRows] = await db.query(`
            SELECT
              COUNT(*) AS total_invoices,
              SUM(CASE WHEN status IN ('draft','sent','partial') THEN 1 ELSE 0 END) AS unpaid_count,
              SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS total_collected,
              SUM(balance_due) AS total_outstanding
            FROM invoices
          `);
          invoiceStats = invRows[0];
        } catch (e) { /* invoices table may not exist */ }
      }

      res.render('dashboard/index', {
        title: 'Dashboard — Shopee Report',
        payoutStats, affiliates, recentPayouts, affiliateSummary,
        invoiceStats, rate, user
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.render('error', { title: 'Error', message: err.message, user: req.session.user });
    }
  }
};

module.exports = dashboardController;

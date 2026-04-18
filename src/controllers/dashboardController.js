const PayoutEntry = require('../models/PayoutEntry');
const Affiliate = require('../models/Affiliate');
const Setting = require('../models/Setting');
const db = require('../config/database');

const dashboardController = {
  async index(req, res) {
    try {
      const user = req.session.user;
      const studioId = user.role === 'studio' ? user.studio_id : null;
      const rate = parseFloat(await Setting.get('myr_to_idr_rate')) || 3600;

      // Deductions
      const allSettings = await Setting.getAll();
      const deductions = {
        general: parseFloat(allSettings.deduction_general_percent || 0),
        myAdmin: parseFloat(allSettings.deduction_my_admin_percent || 0),
        idAdmin: parseFloat(allSettings.deduction_id_admin_percent || 0),
      };

      const payoutStats = await PayoutEntry.getStats({ studioId });
      const affiliates = studioId ? await Affiliate.findByStudio(studioId) : await Affiliate.findAll();
      const recentPayouts = await PayoutEntry.findAll({ limit: 10, studioId });

      // Per-affiliate summary (scoped)
      let studioWhere = '';
      const params = [];
      if (studioId) { studioWhere = 'AND a.studio_id = ?'; params.push(studioId); }
      const [affiliateSummary] = await db.query(`
        SELECT
          COALESCE(a.full_name, pe.extracted_name) AS name,
          COUNT(*) AS entry_count,
          COALESCE(SUM(pe.payout_amount), 0) AS total_myr,
          SUM(CASE WHEN pe.payment_status='processing' THEN 1 ELSE 0 END) AS processing_count,
          SUM(CASE WHEN pe.payment_status='completed' THEN 1 ELSE 0 END) AS completed_count
        FROM payout_entries pe
        LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
        WHERE 1=1 ${studioWhere}
        GROUP BY COALESCE(a.full_name, pe.extracted_name)
        ORDER BY total_myr DESC
        LIMIT 10
      `, params);

      res.render('dashboard/index', {
        title: 'Dashboard — Shopee Report',
        payoutStats, affiliates, recentPayouts, affiliateSummary, rate, deductions, user
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.render('error', { title: 'Error', message: err.message, user: req.session.user });
    }
  }
};

module.exports = dashboardController;

const PayoutPeriod = require('../models/PayoutPeriod');
const Invoice = require('../models/Invoice');
const db = require('../config/database');

const dashboardController = {
  async index(req, res) {
    try {
      const user = req.session.user;
      let stats = {};

      // Shopee stats (all roles see these)
      const [payoutRows] = await db.query(`
        SELECT
          COUNT(*) AS total_periods,
          SUM(CASE WHEN status != 'complete' THEN 1 ELSE 0 END) AS pending_periods,
          SUM(CASE WHEN status = 'complete' THEN net_to_ish ELSE 0 END) AS total_received
        FROM payout_periods
      `);
      stats.payout = payoutRows[0];

      // Invoice stats (ISH admins + superadmin only)
      if (user.role !== 'malaysian_admin') {
        const [invRows] = await db.query(`
          SELECT
            COUNT(*) AS total_invoices,
            SUM(CASE WHEN status IN ('draft','sent','partial') THEN 1 ELSE 0 END) AS unpaid_count,
            SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS total_collected,
            SUM(balance_due) AS total_outstanding
          FROM invoices
        `);
        stats.invoice = invRows[0];
      }

      // Recent payout periods
      const recentPayouts = await PayoutPeriod.findAll();
      const recent = recentPayouts.slice(0, 5);

      res.render('dashboard/index', {
        title: 'Dashboard — Shopee Report',
        stats,
        recentPayouts: recent,
        user
      });
    } catch (err) {
      console.error(err);
      res.render('error', { title: 'Error', message: err.message, user: req.session.user });
    }
  }
};

module.exports = dashboardController;

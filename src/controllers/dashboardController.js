const PayoutEntry = require('../models/PayoutEntry');
const Affiliate = require('../models/Affiliate');
const Setting = require('../models/Setting');
const db = require('../config/database');
const { breakdownEntry } = require('../services/payoutCalc');

const dashboardController = {
  async index(req, res) {
    try {
      const user = req.session.user;
      const studioId = user.role === 'studio' ? user.studio_id : null;
      const rateRow = await Setting.getMeta('myr_to_idr_rate');
      const rate = parseFloat(rateRow?.value) || 3600;
      const rateMeta = { value: rate, updated_at: rateRow?.updated_at || null };

      // Deductions
      const allSettings = await Setting.getAll();
      const deductions = {
        general: parseFloat(allSettings.deduction_general_percent || 0),
        myAdmin: parseFloat(allSettings.deduction_my_admin_percent || 0),
        myHQ:    parseFloat(allSettings.deduction_my_hq_percent    || 0),
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

      // ── MY admin specific data ───────────────────────────────────
      let myAdminData = null;
      if (user.role === 'malaysia_admin' || user.role === 'superadmin') {
        // Pull all entries with bank info
        const [allEntries] = await db.query(`
          SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number
          FROM payout_entries pe
          LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
          ORDER BY pe.invoice_date DESC, pe.updated_at DESC
        `);

        const now = new Date();
        const ymKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : null;
        const thisMonth = ymKey(now);

        const flow = { toCollectMyr: 0, atHandMyr: 0, inTransitMyr: 0, settledMyr: 0,
                       toCollectCount: 0, atHandCount: 0, inTransitCount: 0, settledCount: 0,
                       pendingBanks: new Set() };
        let earningsThisMonth = { admin: 0, hq: 0 };
        let earningsAllTime   = { admin: 0, hq: 0 };
        const periodMap = {};
        const dateLocal = (d) => {
          if (!d) return null;
          const dt = new Date(d);
          if (Number.isNaN(dt.getTime())) return null;
          const yyyy = dt.getFullYear();
          const mm = String(dt.getMonth() + 1).padStart(2, '0');
          const dd = String(dt.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        };

        for (const e of allEntries) {
          const b = breakdownEntry(e, deductions);
          const fromHolder = e.actual_collected_myr != null
            ? parseFloat(e.actual_collected_myr) : b.needToPay;

          // Money flow buckets
          if (e.payment_status === 'processing') {
            flow.toCollectMyr += b.needToPay;
            flow.toCollectCount++;
            flow.pendingBanks.add(`${e.bank_name}::${e.account_number}`);
          } else if (e.payment_status === 'collected') {
            // At hand to MY admin = what they collected − their cut − HQ − Shopee
            flow.atHandMyr += fromHolder - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
            flow.atHandCount++;
          } else if (e.payment_status === 'transferring' || e.payment_status === 'received') {
            flow.inTransitMyr += fromHolder - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
            flow.inTransitCount++;
          } else if (e.payment_status === 'distributed' || e.payment_status === 'completed') {
            const settledM = ymKey(e.invoice_date ? new Date(e.invoice_date) : (e.updated_at ? new Date(e.updated_at) : now));
            if (settledM === thisMonth) {
              flow.settledMyr += fromHolder - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
              flow.settledCount++;
            }
          }

          // Earnings (recognized once entry leaves processing — money has been collected)
          if (e.payment_status !== 'processing') {
            earningsAllTime.admin += b.myAdminFee;
            earningsAllTime.hq    += b.myHQFee;
            const earnedM = ymKey(e.invoice_date ? new Date(e.invoice_date) : (e.updated_at ? new Date(e.updated_at) : now));
            if (earnedM === thisMonth) {
              earningsThisMonth.admin += b.myAdminFee;
              earningsThisMonth.hq    += b.myHQFee;
            }
          }

          // Per-period progress (only periods with at least one non-completed entry)
          const dk = dateLocal(e.invoice_date);
          if (!dk) continue;
          const p = periodMap[dk] ||= {
            invoice_date: dk, total: 0,
            statuses: { processing:0, collected:0, transferring:0, received:0, distributed:0, completed:0 },
            myAdminEarned: 0, period_description: null,
          };
          p.total++;
          p.statuses[e.payment_status] = (p.statuses[e.payment_status] || 0) + 1;
          p.myAdminEarned += b.myAdminFee + b.myHQFee;
          if (e.period_description && !p.period_description) p.period_description = e.period_description;
        }

        const activePeriods = Object.values(periodMap)
          .filter(p => p.statuses.completed < p.total)
          .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))
          .slice(0, 4);

        // Hero action: pick the most pressing thing
        let heroAction;
        if (flow.toCollectCount > 0) {
          heroAction = {
            kind: 'collect',
            title: 'Collect from bank holders',
            amount: flow.toCollectMyr,
            count: flow.toCollectCount,
            banks: flow.pendingBanks.size,
            href: '/shopee/payouts',
            cta: 'Open Payouts',
          };
        } else if (flow.atHandCount > 0) {
          heroAction = {
            kind: 'transfer',
            title: 'Ready to transfer to Indonesia',
            amount: flow.atHandMyr,
            count: flow.atHandCount,
            // Open the payouts page so the user can hit "Mark Transferred" on the
            // appropriate period strip and confirm the actual amount in the modal.
            href: '/shopee/payouts',
            cta: 'Open Payouts',
          };
        } else {
          heroAction = { kind: 'idle', title: 'All caught up', amount: 0, count: 0 };
        }

        // Recent activity — last 8 events with derived label
        const recentActivity = allEntries.slice(0, 8).map(e => {
          let label, when, color;
          switch (e.payment_status) {
            case 'completed':   label = 'Studio confirmed'; color='emerald'; break;
            case 'distributed': label = 'Distributed to studio'; color='orange'; break;
            case 'received':    label = 'Received in Indonesia'; color='purple'; break;
            case 'transferring':label = 'Transferred to Indonesia'; color='indigo'; break;
            case 'collected':   label = 'Collected from bank'; color='amber'; break;
            default:            label = 'Pending collection'; color='slate';
          }
          when = e.payment_time || e.updated_at || e.created_at;
          return { id: e.id, label, color, when, holder: e.affiliate_name || e.extracted_name, amount: e.payout_amount };
        });

        myAdminData = {
          flow: { ...flow, pendingBanks: flow.pendingBanks.size },
          earningsThisMonth, earningsAllTime,
          activePeriods, heroAction, recentActivity,
        };
      }

      // ── ID admin specific data ───────────────────────────────────
      let idAdminData = null;
      if (user.role === 'indonesia_admin' || user.role === 'superadmin') {
        const [allEntries] = await db.query(`
          SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.studio_id, s.name AS studio_name
          FROM payout_entries pe
          LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
          LEFT JOIN studios s ON a.studio_id = s.id
          ORDER BY pe.updated_at DESC
        `);

        const now = new Date();
        const ymKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : null;
        const thisMonth = ymKey(now);

        const flow = { incomingMyr: 0, incomingCount: 0, incomingBatches: new Set(),
                       toDistributeMyr: 0, toDistributeCount: 0, distributeStudios: new Set(),
                       paidThisMonthIdr: 0, paidThisMonthCount: 0 };
        let earningsThisMonthMyr = 0, earningsAllTimeMyr = 0;

        // Per-entry "received" amount (prefer actual_received_myr from MY admin's transfer)
        const receivedFor = (e, b) => {
          if (e.actual_received_myr != null) return parseFloat(e.actual_received_myr);
          // Fallback: derive from collected (or expected)
          if (e.actual_collected_myr != null) {
            return parseFloat(e.actual_collected_myr) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
          }
          return b.netToTransfer;
        };

        for (const e of allEntries) {
          const b = breakdownEntry(e, deductions);
          const received = Math.max(0, receivedFor(e, b));
          // Scale ID admin's commission proportionally if actual differed from expected.
          const ratio = b.netToTransfer > 0 ? received / b.netToTransfer : 1;
          const idCommission = b.idAdminFee * ratio;

          if (e.payment_status === 'transferring') {
            flow.incomingMyr += received;
            flow.incomingCount++;
            if (e.transfer_proof_path) flow.incomingBatches.add(e.transfer_proof_path);
          } else if (e.payment_status === 'received') {
            flow.toDistributeMyr += received;
            flow.toDistributeCount++;
            flow.distributeStudios.add(e.studio_id ?? 'unassigned');
          } else if (e.payment_status === 'distributed' || e.payment_status === 'completed') {
            const idr = e.actual_distributed_idr != null ? parseFloat(e.actual_distributed_idr) : (received - idCommission) * rate;
            const m = ymKey(e.updated_at ? new Date(e.updated_at) : now);
            if (m === thisMonth) {
              flow.paidThisMonthIdr += idr;
              flow.paidThisMonthCount++;
            }
          }

          // ID commission (recognized once entry is at 'received' or beyond)
          if (['received','distributed','completed'].includes(e.payment_status)) {
            earningsAllTimeMyr += idCommission;
            const m = ymKey(e.updated_at ? new Date(e.updated_at) : now);
            if (m === thisMonth) earningsThisMonthMyr += idCommission;
          }
        }

        // Hero action — what to do next
        let heroAction;
        if (flow.incomingCount > 0) {
          heroAction = {
            kind: 'confirm',
            title: 'Confirm incoming transfers from Malaysia',
            amount: flow.incomingMyr,
            count: flow.incomingCount,
            batches: flow.incomingBatches.size,
            href: '/shopee/payouts',
            cta: 'Open Payouts',
          };
        } else if (flow.toDistributeCount > 0) {
          heroAction = {
            kind: 'distribute',
            title: 'Distribute to studios',
            amount: flow.toDistributeMyr,
            count: flow.toDistributeCount,
            studios: flow.distributeStudios.size,
            href: '/shopee/payouts/studio-payments',
            cta: 'Open Studio Payments',
          };
        } else {
          heroAction = { kind: 'idle', title: 'All caught up', amount: 0, count: 0 };
        }

        idAdminData = {
          flow: { ...flow, incomingBatches: flow.incomingBatches.size, distributeStudios: flow.distributeStudios.size },
          earningsThisMonthMyr, earningsAllTimeMyr,
          heroAction
        };
      }

      res.render('dashboard/index', {
        title: 'Dashboard — Shopee Report',
        payoutStats, affiliates, recentPayouts, affiliateSummary, rate, rateMeta, deductions, user,
        myAdminData, idAdminData
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.render('error', { title: 'Error', message: err.message, user: req.session.user });
    }
  }
};

module.exports = dashboardController;

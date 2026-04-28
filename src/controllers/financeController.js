const db = require('../config/database');
const Studio = require('../models/Studio');

// All amounts here are IDR. The finance module is per-STUDIO bookkeeping
// (income from Shopee distributions, staff payroll, monthly expenses) so
// each studio's P&L can be tracked independently. Access is restricted at
// the route layer to indonesia_admin + superadmin.

const floorIDR = (n) => Math.floor(Math.max(0, parseFloat(n) || 0) / 100) * 100;

// ── salary calc: single source of truth ────────────────────────────
// Hourly: hours × rate + days × cashback
// Fixed:  monthly_salary + days × cashback
function calcStaffPayout({ salary_type, hourly_rate, monthly_salary, lunch_cashback, hours, days }) {
  const h    = parseFloat(hours)            || 0;
  const d    = parseInt(days, 10)           || 0;
  const hr   = parseFloat(hourly_rate)      || 0;
  const ms   = parseFloat(monthly_salary)   || 0;
  const cb   = parseFloat(lunch_cashback)   || 0;
  const lunchTotal = d * cb;
  const base = salary_type === 'fixed' ? ms : (h * hr);
  return base + lunchTotal;
}

const monthLabel = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// Income for a studio in a given (year, month):
// sum of actual_distributed_idr from payout entries that were marked
// distributed/completed during that month.
async function studioMonthIncome(studioId, year, month) {
  const [rows] = await db.query(`
    SELECT COALESCE(SUM(pe.actual_distributed_idr), 0) AS income_idr,
           COUNT(*)                                     AS entry_count
    FROM payout_entries pe
    LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
    WHERE a.studio_id = ?
      AND pe.payment_status IN ('distributed','completed')
      AND pe.actual_distributed_idr IS NOT NULL
      AND YEAR(pe.updated_at)  = ?
      AND MONTH(pe.updated_at) = ?
  `, [studioId, year, month]);
  return { income: parseFloat(rows[0].income_idr) || 0, count: parseInt(rows[0].entry_count, 10) || 0 };
}

const financeController = {
  // ── Landing: studio picker + per-studio quick KPIs (this month) ──
  async index(req, res) {
    const studios = await Studio.findAll();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    const studioCards = await Promise.all(studios.map(async (s) => {
      // This month's payroll + expenses
      const [periodRows] = await db.query(
        'SELECT id FROM finance_periods WHERE studio_id=? AND year=? AND month=?',
        [s.id, y, m]
      );
      let payroll = 0, expenses = 0, payrollCount = 0, expenseCount = 0;
      if (periodRows.length) {
        const pid = periodRows[0].id;
        const [[p]] = await db.query('SELECT COALESCE(SUM(calculated_amount_idr),0) v, COUNT(*) c FROM finance_staff_payouts WHERE finance_period_id=?', [pid]);
        const [[e]] = await db.query('SELECT COALESCE(SUM(amount_idr),0) v, COUNT(*) c FROM finance_expenses WHERE finance_period_id=?', [pid]);
        payroll = parseFloat(p.v) || 0; payrollCount = parseInt(p.c, 10) || 0;
        expenses = parseFloat(e.v) || 0; expenseCount = parseInt(e.c, 10) || 0;
      }
      const inc = await studioMonthIncome(s.id, y, m);
      const [[staffCount]] = await db.query('SELECT COUNT(*) c FROM finance_staff WHERE studio_id=? AND is_active=1', [s.id]);

      return {
        ...s,
        income: inc.income,
        incomeCount: inc.count,
        payroll, payrollCount,
        expenses, expenseCount,
        net: inc.income - payroll - expenses,
        activeStaff: parseInt(staffCount.c, 10) || 0,
      };
    }));

    res.render('finance/index', {
      title: 'Finance',
      user: req.session.user,
      studios: studioCards,
      currentY: y, currentM: m,
      currentLabel: monthLabel(y, m),
    });
  },

  // ── Per-studio finance home: list of months with P&L ──
  async getStudio(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const studio = await Studio.findById(studioId);
    if (!studio) { req.flash('error', 'Studio not found.'); return res.redirect('/finance'); }

    // Months that have ANY activity for this studio: either a finance_period row,
    // or income (distributed/completed entries). Union them so months with only
    // income (no manual payroll yet) still appear.
    const [periodRows] = await db.query(`
      SELECT fp.year, fp.month, fp.status,
        COALESCE((SELECT SUM(calculated_amount_idr) FROM finance_staff_payouts WHERE finance_period_id = fp.id), 0) AS payroll,
        COALESCE((SELECT SUM(amount_idr)             FROM finance_expenses      WHERE finance_period_id = fp.id), 0) AS expenses
      FROM finance_periods fp
      WHERE fp.studio_id = ?
      ORDER BY fp.year DESC, fp.month DESC
    `, [studioId]);

    const [incomeRows] = await db.query(`
      SELECT YEAR(pe.updated_at) AS year, MONTH(pe.updated_at) AS month,
             COALESCE(SUM(pe.actual_distributed_idr), 0) AS income,
             COUNT(*)                                     AS income_count
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      WHERE a.studio_id = ?
        AND pe.payment_status IN ('distributed','completed')
        AND pe.actual_distributed_idr IS NOT NULL
      GROUP BY YEAR(pe.updated_at), MONTH(pe.updated_at)
      ORDER BY year DESC, month DESC
    `, [studioId]);

    // Merge into a single map keyed by year-month
    const map = new Map();
    for (const r of periodRows) {
      const k = `${r.year}-${r.month}`;
      map.set(k, {
        year: r.year, month: r.month, status: r.status,
        payroll: parseFloat(r.payroll) || 0,
        expenses: parseFloat(r.expenses) || 0,
        income: 0, income_count: 0,
        hasReport: true,
      });
    }
    for (const r of incomeRows) {
      const k = `${r.year}-${r.month}`;
      const existing = map.get(k);
      if (existing) {
        existing.income = parseFloat(r.income) || 0;
        existing.income_count = parseInt(r.income_count, 10) || 0;
      } else {
        map.set(k, {
          year: r.year, month: r.month, status: 'draft',
          payroll: 0, expenses: 0,
          income: parseFloat(r.income) || 0,
          income_count: parseInt(r.income_count, 10) || 0,
          hasReport: false,
        });
      }
    }
    const months = [...map.values()]
      .sort((a, b) => (b.year - a.year) || (b.month - a.month))
      .map(m => ({ ...m, label: monthLabel(m.year, m.month), net: m.income - m.payroll - m.expenses }));

    const totals = months.reduce((acc, m) => ({
      income:   acc.income   + m.income,
      payroll:  acc.payroll  + m.payroll,
      expenses: acc.expenses + m.expenses,
      net:      acc.net      + m.net,
    }), { income: 0, payroll: 0, expenses: 0, net: 0 });

    const now = new Date();
    res.render('finance/studio', {
      title: `Finance — ${studio.name}`,
      user: req.session.user,
      studio,
      months,
      totals,
      currentY: now.getFullYear(),
      currentM: now.getMonth() + 1,
    });
  },

  // ── Open / create monthly report for a specific studio ──
  async postPeriodCreate(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const y = parseInt(req.body.year, 10);
    const m = parseInt(req.body.month, 10);
    if (!studioId || !Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
      req.flash('error', 'Invalid year/month.');
      return res.redirect(`/finance/${studioId}`);
    }
    const [existing] = await db.query('SELECT id FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    if (!existing.length) {
      await db.query('INSERT INTO finance_periods (studio_id, year, month, created_by) VALUES (?, ?, ?, ?)', [studioId, y, m, req.session.user.id]);
    }
    res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
  },

  // ── Monthly report detail ──
  async getPeriod(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    if (!studioId || !Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      req.flash('error', 'Invalid period.');
      return res.redirect('/finance');
    }
    const studio = await Studio.findById(studioId);
    if (!studio) { req.flash('error', 'Studio not found.'); return res.redirect('/finance'); }

    // Auto-create the period if missing.
    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (studio_id, year, month, created_by) VALUES (?, ?, ?, ?)', [studioId, y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    }
    const period = periodRows[0];

    // Active staff for THIS studio.
    const [activeStaff] = await db.query('SELECT * FROM finance_staff WHERE studio_id=? AND is_active=1 ORDER BY name', [studioId]);

    const [payoutRows] = await db.query(`
      SELECT fsp.*, fs.name AS staff_name, fs.role_title, fs.is_active AS staff_is_active,
             fs.salary_type AS current_salary_type,
             fs.hourly_rate_idr AS current_hourly_rate,
             fs.monthly_salary_idr AS current_monthly_salary,
             fs.lunch_cashback_per_day_idr AS current_lunch_cashback
      FROM finance_staff_payouts fsp
      JOIN finance_staff fs ON fs.id = fsp.staff_id
      WHERE fsp.finance_period_id = ?
      ORDER BY fs.name
    `, [period.id]);
    const payoutByStaff = Object.fromEntries(payoutRows.map(p => [p.staff_id, p]));

    const staffPayouts = activeStaff.map(s => payoutByStaff[s.id] || {
      id: null,
      finance_period_id: period.id,
      staff_id: s.id,
      staff_name: s.name,
      role_title: s.role_title,
      staff_is_active: 1,
      hours_worked: 0,
      days_worked: 0,
      salary_type_snapshot: s.salary_type,
      hourly_rate_snapshot_idr: s.hourly_rate_idr,
      monthly_salary_snapshot_idr: s.monthly_salary_idr,
      lunch_cashback_snapshot_idr: s.lunch_cashback_per_day_idr,
      calculated_amount_idr: 0,
      current_salary_type:    s.salary_type,
      current_hourly_rate:    s.hourly_rate_idr,
      current_monthly_salary: s.monthly_salary_idr,
      current_lunch_cashback: s.lunch_cashback_per_day_idr,
    });
    for (const p of payoutRows) {
      if (!staffPayouts.some(sp => sp.staff_id === p.staff_id)) staffPayouts.push(p);
    }

    const [expenses] = await db.query(`
      SELECT * FROM finance_expenses WHERE finance_period_id = ? ORDER BY expense_date DESC, id DESC
    `, [period.id]);

    // Per-month income from Shopee distributions for this studio + entries breakdown
    const [incomeEntries] = await db.query(`
      SELECT pe.id, pe.actual_distributed_idr, pe.actual_fx_rate, pe.invoice_date,
             pe.invoice_number, pe.period_description, pe.updated_at,
             pe.payment_status, a.full_name AS affiliate_name
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      WHERE a.studio_id = ?
        AND pe.payment_status IN ('distributed','completed')
        AND pe.actual_distributed_idr IS NOT NULL
        AND YEAR(pe.updated_at) = ?
        AND MONTH(pe.updated_at) = ?
      ORDER BY pe.updated_at DESC
    `, [studioId, y, m]);
    const income = incomeEntries.reduce((s, e) => s + parseFloat(e.actual_distributed_idr || 0), 0);

    const totals = {
      income,
      payroll:  staffPayouts.reduce((s, p) => s + parseFloat(p.calculated_amount_idr || 0), 0),
      expenses: expenses.reduce((s, e) => s + parseFloat(e.amount_idr || 0), 0),
    };
    totals.outflow = totals.payroll + totals.expenses;
    totals.net     = totals.income - totals.outflow;

    res.render('finance/period', {
      title: `${studio.name} — ${monthLabel(y, m)}`,
      user: req.session.user,
      studio,
      period: { ...period, label: monthLabel(y, m) },
      staffPayouts,
      expenses,
      incomeEntries,
      totals,
    });
  },

  async postPayoutUpsert(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const staffId = parseInt(req.body.staff_id, 10);
    const hours   = parseFloat(req.body.hours_worked) || 0;
    const days    = parseInt(req.body.days_worked, 10) || 0;
    const notes   = (req.body.notes || '').trim() || null;

    if (!studioId || !Number.isInteger(y) || !Number.isInteger(m) || !staffId) {
      req.flash('error', 'Invalid form data.');
      return res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
    }
    const [staffRows] = await db.query('SELECT * FROM finance_staff WHERE id=? AND studio_id=?', [staffId, studioId]);
    if (!staffRows.length) {
      req.flash('error', 'Staff not found in this studio.');
      return res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
    }
    const staff = staffRows[0];

    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (studio_id, year, month, created_by) VALUES (?, ?, ?, ?)', [studioId, y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    }
    const period = periodRows[0];

    const calculated = floorIDR(calcStaffPayout({
      salary_type:    staff.salary_type,
      hourly_rate:    staff.hourly_rate_idr,
      monthly_salary: staff.monthly_salary_idr,
      lunch_cashback: staff.lunch_cashback_per_day_idr,
      hours, days,
    }));

    await db.query(`
      INSERT INTO finance_staff_payouts
        (finance_period_id, staff_id, hours_worked, days_worked,
         salary_type_snapshot, hourly_rate_snapshot_idr, monthly_salary_snapshot_idr,
         lunch_cashback_snapshot_idr, calculated_amount_idr, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        hours_worked = VALUES(hours_worked),
        days_worked  = VALUES(days_worked),
        salary_type_snapshot         = VALUES(salary_type_snapshot),
        hourly_rate_snapshot_idr     = VALUES(hourly_rate_snapshot_idr),
        monthly_salary_snapshot_idr  = VALUES(monthly_salary_snapshot_idr),
        lunch_cashback_snapshot_idr  = VALUES(lunch_cashback_snapshot_idr),
        calculated_amount_idr        = VALUES(calculated_amount_idr),
        notes = VALUES(notes)
    `, [
      period.id, staffId, hours, days,
      staff.salary_type, staff.hourly_rate_idr, staff.monthly_salary_idr,
      staff.lunch_cashback_per_day_idr, calculated, notes,
    ]);

    req.flash('success', `Saved ${staff.name} payout — IDR ${calculated.toLocaleString('id-ID')}.`);
    res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
  },

  async postExpenseCreate(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const { category, description, amount_idr, expense_date } = req.body;
    if (!category || !amount_idr) {
      req.flash('error', 'Category and amount are required.');
      return res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
    }
    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (studio_id, year, month, created_by) VALUES (?, ?, ?, ?)', [studioId, y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE studio_id=? AND year=? AND month=?', [studioId, y, m]);
    }
    const period = periodRows[0];
    const amount = floorIDR(amount_idr);
    const date   = expense_date && /^\d{4}-\d{2}-\d{2}$/.test(expense_date) ? expense_date : null;
    await db.query(`
      INSERT INTO finance_expenses (finance_period_id, category, description, amount_idr, expense_date)
      VALUES (?, ?, ?, ?, ?)
    `, [period.id, category.trim(), (description || '').trim() || null, amount, date]);
    req.flash('success', `Expense added — ${category} IDR ${amount.toLocaleString('id-ID')}.`);
    res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
  },

  async postExpenseDelete(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const id = parseInt(req.params.id, 10);
    await db.query('DELETE FROM finance_expenses WHERE id=?', [id]);
    req.flash('success', 'Expense deleted.');
    res.redirect(`/finance/${studioId}/${y}/${String(m).padStart(2,'0')}`);
  },

  // ── Staff management (per-studio) ──
  async getStaff(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const studio = await Studio.findById(studioId);
    if (!studio) { req.flash('error', 'Studio not found.'); return res.redirect('/finance'); }
    const [staff] = await db.query('SELECT * FROM finance_staff WHERE studio_id=? ORDER BY is_active DESC, name', [studioId]);
    res.render('finance/staff', {
      title: `${studio.name} — Staff`,
      user: req.session.user,
      studio,
      staff,
    });
  },

  async postStaffCreate(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const { name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes } = req.body;
    if (!studioId || !name || !['hourly','fixed'].includes(salary_type)) {
      req.flash('error', 'Name and a valid salary type are required.');
      return res.redirect(`/finance/${studioId}/staff`);
    }
    await db.query(`
      INSERT INTO finance_staff (studio_id, name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      studioId,
      name.trim(),
      (role_title || '').trim() || null,
      salary_type,
      salary_type === 'hourly' ? (parseFloat(hourly_rate_idr) || 0) : null,
      salary_type === 'fixed'  ? (parseFloat(monthly_salary_idr) || 0) : null,
      lunch_cashback_per_day_idr ? (parseFloat(lunch_cashback_per_day_idr) || 0) : null,
      (notes || '').trim() || null,
    ]);
    req.flash('success', `${name} added.`);
    res.redirect(`/finance/${studioId}/staff`);
  },

  async postStaffUpdate(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const id = parseInt(req.params.id, 10);
    const { name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes, is_active } = req.body;
    if (!name || !['hourly','fixed'].includes(salary_type)) {
      req.flash('error', 'Name and a valid salary type are required.');
      return res.redirect(`/finance/${studioId}/staff`);
    }
    await db.query(`
      UPDATE finance_staff
      SET name=?, role_title=?, salary_type=?, hourly_rate_idr=?, monthly_salary_idr=?,
          lunch_cashback_per_day_idr=?, notes=?, is_active=?
      WHERE id=? AND studio_id=?
    `, [
      name.trim(),
      (role_title || '').trim() || null,
      salary_type,
      salary_type === 'hourly' ? (parseFloat(hourly_rate_idr) || 0) : null,
      salary_type === 'fixed'  ? (parseFloat(monthly_salary_idr) || 0) : null,
      lunch_cashback_per_day_idr ? (parseFloat(lunch_cashback_per_day_idr) || 0) : null,
      (notes || '').trim() || null,
      is_active ? 1 : 0,
      id, studioId,
    ]);
    req.flash('success', `${name} updated.`);
    res.redirect(`/finance/${studioId}/staff`);
  },

  async postStaffDelete(req, res) {
    const studioId = parseInt(req.params.studioId, 10);
    const id = parseInt(req.params.id, 10);
    await db.query('UPDATE finance_staff SET is_active=0 WHERE id=? AND studio_id=?', [id, studioId]);
    req.flash('success', 'Staff deactivated (history preserved).');
    res.redirect(`/finance/${studioId}/staff`);
  },
};

module.exports = financeController;

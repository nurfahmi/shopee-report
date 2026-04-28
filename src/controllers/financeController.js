const db = require('../config/database');

// All amounts here are IDR. The finance module is for studio operations
// (staff payroll + monthly running costs) — completely separate from the
// Shopee payout pipeline. Access is restricted at the route layer to
// indonesia_admin + superadmin.

// Floor IDR to nearest 100 — Indonesian banks/PBs don't transfer fractional rupiahs.
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

const monthLabel = (y, m) => {
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const financeController = {
  // ── Landing page: list every monthly report + KPIs for current month ──
  async index(req, res) {
    const [periods] = await db.query(`
      SELECT
        fp.*,
        COALESCE((SELECT SUM(calculated_amount_idr) FROM finance_staff_payouts WHERE finance_period_id = fp.id), 0) AS payroll_total,
        COALESCE((SELECT COUNT(*)                    FROM finance_staff_payouts WHERE finance_period_id = fp.id), 0) AS payroll_count,
        COALESCE((SELECT SUM(amount_idr)             FROM finance_expenses      WHERE finance_period_id = fp.id), 0) AS expenses_total,
        COALESCE((SELECT COUNT(*)                    FROM finance_expenses      WHERE finance_period_id = fp.id), 0) AS expenses_count
      FROM finance_periods fp
      ORDER BY fp.year DESC, fp.month DESC
    `);

    const [staffRows] = await db.query(`SELECT COUNT(*) AS cnt FROM finance_staff WHERE is_active = 1`);
    const activeStaff = parseInt(staffRows[0].cnt, 10) || 0;

    const now = new Date();
    const currentY = now.getFullYear();
    const currentM = now.getMonth() + 1;
    const currentPeriod = periods.find(p => p.year === currentY && p.month === currentM) || null;

    res.render('finance/index', {
      title: 'Finance',
      user: req.session.user,
      periods: periods.map(p => ({ ...p, label: monthLabel(p.year, p.month) })),
      currentY, currentM,
      currentPeriod,
      activeStaff,
    });
  },

  // ── Create a new monthly report (or jump straight to existing one) ──
  async postPeriodCreate(req, res) {
    const { year, month } = req.body;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
      req.flash('error', 'Invalid year/month.');
      return res.redirect('/finance');
    }
    // Idempotent — if exists, just redirect.
    const [existing] = await db.query('SELECT id FROM finance_periods WHERE year=? AND month=?', [y, m]);
    if (!existing.length) {
      await db.query('INSERT INTO finance_periods (year, month, created_by) VALUES (?, ?, ?)', [y, m, req.session.user.id]);
    }
    res.redirect(`/finance/${y}/${String(m).padStart(2, '0')}`);
  },

  // ── Monthly report detail — staff payouts + expenses for one period ──
  async getPeriod(req, res) {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      req.flash('error', 'Invalid period.');
      return res.redirect('/finance');
    }

    // Auto-create the period if missing — friendly UX (one click "open this month").
    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (year, month, created_by) VALUES (?, ?, ?)', [y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    }
    const period = periodRows[0];

    // Active staff — used to seed missing payout lines so ID admin doesn't have
    // to remember every name. Each active staff gets a row (real or placeholder).
    const [activeStaff] = await db.query('SELECT * FROM finance_staff WHERE is_active=1 ORDER BY name');

    // Existing payout lines for this period (joined with staff so we can show name + type even
    // if the staff record was later edited).
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

    // Build one row per active staff: existing payout if present, otherwise a zero placeholder.
    const staffPayouts = activeStaff.map(s => {
      const existing = payoutByStaff[s.id];
      if (existing) return existing;
      return {
        id: null, // placeholder — no DB row yet
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
      };
    });
    // Plus any payout rows for staff that have since been deactivated — keep them
    // visible so the historical record stays accurate.
    for (const p of payoutRows) {
      if (!staffPayouts.some(sp => sp.staff_id === p.staff_id)) staffPayouts.push(p);
    }

    const [expenses] = await db.query(`
      SELECT * FROM finance_expenses WHERE finance_period_id = ? ORDER BY expense_date DESC, id DESC
    `, [period.id]);

    const totals = {
      payroll: staffPayouts.reduce((s, p) => s + parseFloat(p.calculated_amount_idr || 0), 0),
      expenses: expenses.reduce((s, e) => s + parseFloat(e.amount_idr || 0), 0),
    };
    totals.grand = totals.payroll + totals.expenses;

    res.render('finance/period', {
      title: `Finance — ${monthLabel(y, m)}`,
      user: req.session.user,
      period: { ...period, label: monthLabel(y, m) },
      staffPayouts,
      expenses,
      totals,
    });
  },

  // ── Upsert one staff payout line (hours + days) ──
  // POST /finance/:year/:month/payout
  async postPayoutUpsert(req, res) {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const staffId = parseInt(req.body.staff_id, 10);
    const hours   = parseFloat(req.body.hours_worked) || 0;
    const days    = parseInt(req.body.days_worked, 10) || 0;
    const notes   = (req.body.notes || '').trim() || null;

    if (!Number.isInteger(y) || !Number.isInteger(m) || !staffId) {
      req.flash('error', 'Invalid form data.');
      return res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
    }

    const [staffRows] = await db.query('SELECT * FROM finance_staff WHERE id=?', [staffId]);
    if (!staffRows.length) {
      req.flash('error', 'Staff not found.');
      return res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
    }
    const staff = staffRows[0];

    // Find or create the period.
    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (year, month, created_by) VALUES (?, ?, ?)', [y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    }
    const period = periodRows[0];

    // Snapshot the current rate so historical reports don't mutate when staff settings change.
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
    res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
  },

  // ── Add expense ──
  async postExpenseCreate(req, res) {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const { category, description, amount_idr, expense_date } = req.body;
    if (!category || !amount_idr) {
      req.flash('error', 'Category and amount are required.');
      return res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
    }
    let [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    if (!periodRows.length) {
      await db.query('INSERT INTO finance_periods (year, month, created_by) VALUES (?, ?, ?)', [y, m, req.session.user.id]);
      [periodRows] = await db.query('SELECT * FROM finance_periods WHERE year=? AND month=?', [y, m]);
    }
    const period = periodRows[0];
    const amount = floorIDR(amount_idr);
    const date   = expense_date && /^\d{4}-\d{2}-\d{2}$/.test(expense_date) ? expense_date : null;
    await db.query(`
      INSERT INTO finance_expenses (finance_period_id, category, description, amount_idr, expense_date)
      VALUES (?, ?, ?, ?, ?)
    `, [period.id, category.trim(), (description || '').trim() || null, amount, date]);
    req.flash('success', `Expense added — ${category} IDR ${amount.toLocaleString('id-ID')}.`);
    res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
  },

  async postExpenseDelete(req, res) {
    const y = parseInt(req.params.year, 10);
    const m = parseInt(req.params.month, 10);
    const id = parseInt(req.params.id, 10);
    await db.query('DELETE FROM finance_expenses WHERE id=?', [id]);
    req.flash('success', 'Expense deleted.');
    res.redirect(`/finance/${y}/${String(m).padStart(2,'0')}`);
  },

  // ── Staff management ──
  async getStaff(req, res) {
    const [staff] = await db.query('SELECT * FROM finance_staff ORDER BY is_active DESC, name');
    res.render('finance/staff', {
      title: 'Finance — Staff',
      user: req.session.user,
      staff,
    });
  },

  async postStaffCreate(req, res) {
    const { name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes } = req.body;
    if (!name || !['hourly','fixed'].includes(salary_type)) {
      req.flash('error', 'Name and a valid salary type are required.');
      return res.redirect('/finance/staff');
    }
    await db.query(`
      INSERT INTO finance_staff (name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      name.trim(),
      (role_title || '').trim() || null,
      salary_type,
      salary_type === 'hourly' ? (parseFloat(hourly_rate_idr) || 0) : null,
      salary_type === 'fixed'  ? (parseFloat(monthly_salary_idr) || 0) : null,
      lunch_cashback_per_day_idr ? (parseFloat(lunch_cashback_per_day_idr) || 0) : null,
      (notes || '').trim() || null,
    ]);
    req.flash('success', `${name} added.`);
    res.redirect('/finance/staff');
  },

  async postStaffUpdate(req, res) {
    const id = parseInt(req.params.id, 10);
    const { name, role_title, salary_type, hourly_rate_idr, monthly_salary_idr, lunch_cashback_per_day_idr, notes, is_active } = req.body;
    if (!name || !['hourly','fixed'].includes(salary_type)) {
      req.flash('error', 'Name and a valid salary type are required.');
      return res.redirect('/finance/staff');
    }
    await db.query(`
      UPDATE finance_staff
      SET name=?, role_title=?, salary_type=?, hourly_rate_idr=?, monthly_salary_idr=?,
          lunch_cashback_per_day_idr=?, notes=?, is_active=?
      WHERE id=?
    `, [
      name.trim(),
      (role_title || '').trim() || null,
      salary_type,
      salary_type === 'hourly' ? (parseFloat(hourly_rate_idr) || 0) : null,
      salary_type === 'fixed'  ? (parseFloat(monthly_salary_idr) || 0) : null,
      lunch_cashback_per_day_idr ? (parseFloat(lunch_cashback_per_day_idr) || 0) : null,
      (notes || '').trim() || null,
      is_active ? 1 : 0,
      id,
    ]);
    req.flash('success', `${name} updated.`);
    res.redirect('/finance/staff');
  },

  async postStaffDelete(req, res) {
    const id = parseInt(req.params.id, 10);
    // Soft delete by deactivating — preserves historical payout snapshots.
    await db.query('UPDATE finance_staff SET is_active=0 WHERE id=?', [id]);
    req.flash('success', 'Staff deactivated (history preserved).');
    res.redirect('/finance/staff');
  },
};

module.exports = financeController;

const PayoutEntry   = require('../models/PayoutEntry');
const PayoutPeriod  = require('../models/PayoutPeriod');
const Affiliate     = require('../models/Affiliate');
const Setting       = require('../models/Setting');
const { extractMultiplePayouts } = require('../services/ocrService');
const { renderPDF } = require('../services/pdfService');
const { breakdownEntry } = require('../services/payoutCalc');

// Bank transfer fee charged once per studio per disbursement (deducted from the
// studio's IDR amount). Indonesian banks don't transfer fractional rupiahs so we
// also floor to the nearest 100.
const BANK_FEE_IDR_PER_STUDIO = 7500;
const floorIDR = (n) => Math.floor(Math.max(0, n) / 100) * 100;

async function getRate() {
  return parseFloat(await Setting.get('myr_to_idr_rate')) || 3600;
}

async function getRateMeta() {
  const row = await Setting.getMeta('myr_to_idr_rate');
  const value = parseFloat(row?.value) || 3600;
  return { value, updated_at: row?.updated_at || null };
}

// Format a JS Date / DATE-string as 'YYYY-MM-DD' in local timezone (avoids UTC shift).
function dateKey(d) {
  if (!d) return 'undated';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'undated';
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function getDeductions() {
  const settings = await Setting.getAll();
  return {
    general: parseFloat(settings.deduction_general_percent || 0),
    myAdmin: parseFloat(settings.deduction_my_admin_percent || 0),
    myHQ:    parseFloat(settings.deduction_my_hq_percent    || 0),
    idAdmin: parseFloat(settings.deduction_id_admin_percent || 0),
  };
}

const payoutController = {
  // ── Main page: list all entries ─────────────────────────────────
  async index(req, res) {
    const user = req.session.user;
    const studioId = user.role === 'studio' ? user.studio_id : null;
    const entries = await PayoutEntry.findAll({ studioId });
    const affiliates = studioId ? await Affiliate.findByStudio(studioId) : await Affiliate.findAll();
    const rateMeta = await getRateMeta();
    const rate = rateMeta.value;
    const deductions = await getDeductions();
    const Studio = require('../models/Studio');
    const studios = ['superadmin','indonesia_admin'].includes(user.role) ? await Studio.findAll() : [];

    // ── Helper: per-entry "from holder" amount (use actual when set) ──
    // Expected = gross − bank holder share (matches manual report's "Need to Pay").
    const fromHolder = (e, b) => e.actual_collected_myr != null
      ? parseFloat(e.actual_collected_myr)
      : b.needToPay;

    // ── MY admin settlement: one row per bank account ──────────────
    const bankGroups = {};
    for (const e of entries) {
      if (!['processing','collected'].includes(e.payment_status)) continue;
      const key = `${e.bank_name || '—'}::${e.account_number || '—'}`;
      const g = bankGroups[key] ||= {
        key,
        bank_name: e.bank_name || '—',
        account_number: e.account_number || '—',
        holders: new Set(),
        entries: [],
        processingCount: 0,
        collectedCount: 0,
        invoiceMyr: 0,         // TOTAL SALE ON INV
        shopeeFeeMyr: 0,       // SHOPEE FEE (1%)
        sstFeeMyr: 0,          // SST FEE (8% of Shopee fee)
        holderReceivesMyr: 0,  // RECEIVE MONEY TO ACCT AFTER DEDUCT SHOPEE FEE
        myAdminMyr: 0,         // ADMIN FEE
        myHQMyr: 0,            // HQ FEE
        bankHolderMyr: 0,      // PER PERSON FEE (bank holder share)
        fromHolderMyr: 0,      // NEED TO PAY BY PERSON
        toIndonesiaMyr: 0,     // BALANCE AFTER DEDUCT ALL FEE → SUPPLIER INDONESIA
        expectedFromHolder: 0,
        actualSum: 0,
        hasActuals: false,
      };
      const b = breakdownEntry(e, deductions);
      g.holders.add(e.affiliate_name || e.extracted_name || '—');
      g.entries.push({ ...e, breakdown: b });
      if (e.payment_status === 'processing') g.processingCount++;
      else g.collectedCount++;
      const fh = fromHolder(e, b);
      g.invoiceMyr        += b.gross;
      g.shopeeFeeMyr      += b.shopeeService;
      g.sstFeeMyr         += b.shopeeSST;
      g.holderReceivesMyr += b.netAfterShopee;
      g.myAdminMyr        += b.myAdminFee;
      g.myHQMyr           += b.myHQFee;
      g.bankHolderMyr     += b.bankHolderShare;
      g.fromHolderMyr     += fh;
      // Manual report convention: Shopee + SST are absorbed from MY admin's pool too,
      // so toIndonesia = fromHolder − MY admin − MY HQ − Shopee − SST.
      g.toIndonesiaMyr    += fh - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
      g.expectedFromHolder += b.needToPay;
      if (e.actual_collected_myr != null) {
        g.actualSum   += parseFloat(e.actual_collected_myr) || 0;
        g.hasActuals   = true;
      }
    }
    const bankList = Object.values(bankGroups)
      .map(g => ({ ...g, holders: [...g.holders], delta: g.hasActuals ? g.actualSum - g.expectedFromHolder : null }))
      .sort((a, b) => b.fromHolderMyr - a.fromHolderMyr);

    const sumTotals = (banks) => banks.reduce((t, g) => ({
      invoiceMyr:        t.invoiceMyr        + g.invoiceMyr,
      shopeeFeeMyr:      t.shopeeFeeMyr      + g.shopeeFeeMyr,
      sstFeeMyr:         t.sstFeeMyr         + g.sstFeeMyr,
      holderReceivesMyr: t.holderReceivesMyr + g.holderReceivesMyr,
      myAdminMyr:        t.myAdminMyr        + g.myAdminMyr,
      myHQMyr:           t.myHQMyr           + g.myHQMyr,
      bankHolderMyr:     t.bankHolderMyr     + g.bankHolderMyr,
      fromHolderMyr:     t.fromHolderMyr     + g.fromHolderMyr,
      toIndonesiaMyr:    t.toIndonesiaMyr    + g.toIndonesiaMyr,
      pendingBanks:      t.pendingBanks      + (g.processingCount > 0 ? 1 : 0),
      readyBanks:        t.readyBanks        + (g.processingCount === 0 && g.collectedCount > 0 ? 1 : 0),
    }), { invoiceMyr: 0, shopeeFeeMyr: 0, sstFeeMyr: 0, holderReceivesMyr: 0, myAdminMyr: 0, myHQMyr: 0, bankHolderMyr: 0, fromHolderMyr: 0, toIndonesiaMyr: 0, pendingBanks: 0, readyBanks: 0 });

    const myTotals = sumTotals(bankList);

    // ── Group banks by Shopee payout cycle (invoice_date) ──────────
    // Each invoice_date is one "period" (Shopee pays once per cycle).
    // Use module-level dateKey() — local-tz to avoid UTC shift.
    const periodMap = {};
    for (const g of bankList) {
      // A bank may have entries across multiple invoice_dates; split by date.
      const byDate = {};
      for (const e of g.entries) {
        const d = dateKey(e.invoice_date);
        (byDate[d] ||= []).push(e);
      }
      for (const [dateKey, entriesForDate] of Object.entries(byDate)) {
        // Re-aggregate this slice as a mini-bank for the period
        let inv=0, sf=0, sst=0, hr=0, ma=0, hq=0, bh=0, fh=0, ti=0, pc=0, cc=0, exp=0, act=0, hasA=false;
        for (const e of entriesForDate) {
          const b = e.breakdown;
          inv += b.gross;
          sf  += b.shopeeService;
          sst += b.shopeeSST;
          hr  += b.netAfterShopee;
          ma  += b.myAdminFee;
          hq  += b.myHQFee;
          bh  += b.bankHolderShare;
          const fhE = e.actual_collected_myr != null ? parseFloat(e.actual_collected_myr) : (b.needToPay);
          fh  += fhE;
          // Manual convention: Shopee + SST absorbed from MY admin's pool too.
          ti  += fhE - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
          if (e.payment_status === 'processing') pc++; else cc++;
          exp += b.needToPay;
          if (e.actual_collected_myr != null) { act += parseFloat(e.actual_collected_myr); hasA = true; }
        }
        const periodGroup = periodMap[dateKey] ||= {
          invoice_date: dateKey === 'undated' ? null : dateKey,
          periodDescriptions: new Set(),
          banks: [],
        };
        for (const e of entriesForDate) {
          if (e.period_description) periodGroup.periodDescriptions.add(e.period_description);
        }
        periodGroup.banks.push({
          ...g,
          entries: entriesForDate,
          invoiceMyr: inv, shopeeFeeMyr: sf, sstFeeMyr: sst, holderReceivesMyr: hr,
          myAdminMyr: ma, myHQMyr: hq, bankHolderMyr: bh,
          fromHolderMyr: fh, toIndonesiaMyr: ti,
          processingCount: pc, collectedCount: cc,
          expectedFromHolder: exp, actualSum: act, hasActuals: hasA,
          delta: hasA ? act - exp : null,
        });
      }
    }
    // ── Second pass: enrich each period with role-specific groupings ──
    // For ID admin: incoming transfer batches + studios (received) within this period.
    // For studio: their own entries grouped by status, plus distribution batches awaiting confirmation.
    // We add periods that exist only via these later stages too.
    const ensurePeriod = (k) => {
      if (!periodMap[k]) {
        periodMap[k] = {
          invoice_date: k === 'undated' ? null : k,
          periodDescriptions: new Set(),
          banks: [],
        };
      }
      return periodMap[k];
    };
    for (const e of entries) {
      const k = dateKey(e.invoice_date);
      const period = ensurePeriod(k);
      if (e.period_description) period.periodDescriptions.add(e.period_description);
      const b = breakdownEntry(e, deductions);

      // Incoming transfer batches (status='transferring') grouped by transfer_proof_path
      if (e.payment_status === 'transferring') {
        period.incomingBatches ||= {};
        const tk = e.transfer_proof_path || `manual-${e.id}`;
        const batch = period.incomingBatches[tk] ||= {
          proof: e.transfer_proof_path, ids: [], entries: [], fromMyMyr: 0, count: 0, latest: e.updated_at
        };
        const received = e.actual_received_myr != null
          ? parseFloat(e.actual_received_myr)
          : fromHolder(e, b) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
        batch.ids.push(e.id);
        batch.entries.push({ ...e, breakdown: b });
        batch.fromMyMyr += received;
        batch.count++;
        if (e.updated_at && (!batch.latest || e.updated_at > batch.latest)) batch.latest = e.updated_at;
      }

      // Studios with received-status entries (to distribute) within this period
      if (e.payment_status === 'received') {
        period.studios ||= {};
        const sk = e.studio_id ?? 'unassigned';
        const s = period.studios[sk] ||= {
          studio_id: e.studio_id,
          studio_name: e.studio_name || 'Unassigned',
          entries: [], ids: [], count: 0,
          fromMyMyr: 0, idAdminMyr: 0, toStudioMyr: 0,
        };
        const received = e.actual_received_myr != null
          ? parseFloat(e.actual_received_myr)
          : fromHolder(e, b) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
        const ratio = b.netToTransfer > 0 ? received / b.netToTransfer : 1;
        const studioNet = b.netToStudio * ratio;
        const idAdmin   = b.idAdminFee  * ratio;
        s.count++;
        s.ids.push(e.id);
        s.entries.push({ ...e, breakdown: b, studioNet, idAdminScaled: idAdmin, receivedMyr: received });
        s.fromMyMyr   += received;
        s.idAdminMyr  += idAdmin;
        s.toStudioMyr += studioNet;
      }

      // Pending distributions (status='distributed') grouped by distribution_proof_path — for studio role
      if (e.payment_status === 'distributed') {
        period.distributions ||= {};
        const dk = e.distribution_proof_path || `manual-${e.id}`;
        const d = period.distributions[dk] ||= {
          proof: e.distribution_proof_path, ids: [], entries: [], totalIdr: 0, count: 0
        };
        d.ids.push(e.id);
        d.entries.push(e);
        d.totalIdr += parseFloat(e.actual_distributed_idr) || (parseFloat(e.payout_amount_idr) || 0);
        d.count++;
      }

      // For studio role: their own entries by status within the period
      period.studioEntries ||= [];
      if (studioId) {
        period.studioEntries.push({ ...e, breakdown: b });
      }

      // Track all-stages totals so history periods (everything past 'collected') still
      // render meaningfully for MY admin / ID admin. status counts power the stage chips.
      period._statusCounts ||= { processing:0, collected:0, transferring:0, received:0, distributed:0, completed:0 };
      period._statusCounts[e.payment_status] = (period._statusCounts[e.payment_status] || 0) + 1;
      period._totalEntries = (period._totalEntries || 0) + 1;
      period._grossMyr = (period._grossMyr || 0) + b.gross;
    }

    const periodGroups = Object.values(periodMap)
      .map(p => ({
        ...p,
        periodDescriptions: [...p.periodDescriptions],
        banks: p.banks.sort((a, b) => b.fromHolderMyr - a.fromHolderMyr),
        incomingBatches: p.incomingBatches ? Object.values(p.incomingBatches) : [],
        studios: p.studios ? Object.values(p.studios).sort((a, b) => b.toStudioMyr - a.toStudioMyr) : [],
        distributions: p.distributions ? Object.values(p.distributions) : [],
        studioEntries: p.studioEntries || [],
        totals: sumTotals(p.banks),
        statusCounts: p._statusCounts || { processing:0, collected:0, transferring:0, received:0, distributed:0, completed:0 },
        totalEntries: p._totalEntries || 0,
        grossMyr: p._grossMyr || 0,
      }))
      .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));

    // ── ID admin: incoming transfers (one row per transfer batch) ──
    const incomingMap = {};
    for (const e of entries) {
      if (e.payment_status !== 'transferring') continue;
      const key = e.transfer_proof_path || `manual-${e.id}`;
      const t = incomingMap[key] ||= { proof: e.transfer_proof_path, ids: [], entries: [],
        fromMyMyr: 0, count: 0, latest: e.updated_at };
      const b = breakdownEntry(e, deductions);
      t.ids.push(e.id);
      t.entries.push({ ...e, breakdown: b });
      t.fromMyMyr += fromHolder(e, b) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
      t.count++;
      if (e.updated_at && (!t.latest || e.updated_at > t.latest)) t.latest = e.updated_at;
    }
    const incomingTransfers = Object.values(incomingMap)
      .sort((a, b) => b.fromMyMyr - a.fromMyMyr);

    // ── ID admin settlement: one row per studio for `received` entries ─
    const studioMap = {};
    for (const e of entries) {
      if (e.payment_status !== 'received') continue;
      const key = e.studio_id ?? 'unassigned';
      const s = studioMap[key] ||= {
        studio_id: e.studio_id,
        studio_name: e.studio_name || 'Unassigned',
        count: 0, ids: [],
        fromMyMyr: 0, idAdminMyr: 0, toStudioMyr: 0,
      };
      const b = breakdownEntry(e, deductions);
      // Prefer actual_received_myr (set when MY admin recorded a different actual at transfer time).
      const fromMy = e.actual_received_myr != null
        ? parseFloat(e.actual_received_myr)
        : fromHolder(e, b) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
      // Scale ID admin's slice proportionally if actual differed from expected.
      const idScale = (e.actual_received_myr != null && b.netToTransfer > 0)
        ? parseFloat(e.actual_received_myr) / b.netToTransfer
        : 1;
      s.count++;
      s.ids.push(e.id);
      s.fromMyMyr    += fromMy;
      s.idAdminMyr   += b.idAdminFee * idScale;
      s.toStudioMyr  += fromMy - (b.idAdminFee * idScale);
    }
    const studioSettlement = Object.values(studioMap).sort((a, b) => b.toStudioMyr - a.toStudioMyr);

    const idTotals = studioSettlement.reduce((t, s) => ({
      fromMyMyr:    t.fromMyMyr    + s.fromMyMyr,
      idAdminMyr:   t.idAdminMyr   + s.idAdminMyr,
      toStudioMyr:  t.toStudioMyr  + s.toStudioMyr,
    }), { fromMyMyr: 0, idAdminMyr: 0, toStudioMyr: 0 });

    // ── Studio: distribution batches awaiting confirmation ─────────
    const distroMap = {};
    for (const e of entries) {
      if (e.payment_status !== 'distributed') continue;
      const key = e.distribution_proof_path || `manual-${e.id}`;
      const d = distroMap[key] ||= { proof: e.distribution_proof_path, ids: [], entries: [], totalIdr: 0, count: 0 };
      d.ids.push(e.id);
      d.entries.push(e);
      d.totalIdr += parseFloat(e.actual_distributed_idr) || (parseFloat(e.payout_amount_idr) || 0);
      d.count++;
    }
    const pendingDistributions = Object.values(distroMap);

    // ── Studio-side groupings ──────────────────────────────────────
    // Group all of the studio's entries by Shopee payout cycle (invoice_date),
    // then for each period compute pipeline progress + estimated IDR.
    const studioPeriodMap = {};
    let studioKpi = { pendingIdr: 0, pendingCount: 0, onTheWayIdr: 0, onTheWayCount: 0,
                      paidThisMonthIdr: 0, paidThisMonthCount: 0, paidTotalIdr: 0 };
    const now = new Date();
    for (const e of entries) {
      const k = dateKey(e.invoice_date);
      const period = studioPeriodMap[k] ||= {
        invoice_date: k === 'undated' ? null : k,
        entries: [],
        stages: { processing: 0, collected: 0, transferring: 0, received: 0, distributed: 0, completed: 0 },
        expectedIdr: 0,
        receivedIdr: 0,
        latestUpdate: e.updated_at,
      };
      const b = breakdownEntry(e, deductions);
      period.entries.push({ ...e, breakdown: b });
      period.stages[e.payment_status] = (period.stages[e.payment_status] || 0) + 1;
      const idrForEntry = e.actual_distributed_idr != null
        ? parseFloat(e.actual_distributed_idr)
        : (b.netToStudio * rate);
      period.expectedIdr += idrForEntry;
      if (e.payment_status === 'completed' || e.payment_status === 'distributed') {
        period.receivedIdr += idrForEntry;
      }
      if (e.updated_at && (!period.latestUpdate || e.updated_at > period.latestUpdate)) period.latestUpdate = e.updated_at;

      // KPIs
      if (e.payment_status === 'completed') {
        studioKpi.paidTotalIdr += idrForEntry;
        const d = e.invoice_date ? new Date(e.invoice_date) : (e.updated_at ? new Date(e.updated_at) : now);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
          studioKpi.paidThisMonthIdr += idrForEntry;
          studioKpi.paidThisMonthCount++;
        }
      } else if (e.payment_status === 'distributed') {
        studioKpi.onTheWayIdr += idrForEntry;
        studioKpi.onTheWayCount++;
      } else {
        studioKpi.pendingIdr += idrForEntry;
        studioKpi.pendingCount++;
      }
    }

    // Per-period derived fields (pipeline stage)
    // 5 visual steps: Uploaded → Collected → In Transit → Distributed → Paid
    const STAGE_BUCKETS = [
      { key: 'uploaded',   label: 'Uploaded',    statuses: ['processing'] },
      { key: 'collected',  label: 'Collected',   statuses: ['collected']  },
      { key: 'transit',    label: 'In Transit',  statuses: ['transferring','received'] },
      { key: 'distributed',label: 'Distributed', statuses: ['distributed'] },
      { key: 'paid',       label: 'Paid',        statuses: ['completed']  },
    ];
    const studioPeriods = Object.values(studioPeriodMap)
      .map(p => {
        const total = p.entries.length;
        // Per-bucket counts
        const buckets = STAGE_BUCKETS.map(b => ({
          ...b,
          count: b.statuses.reduce((s, st) => s + (p.stages[st] || 0), 0),
        }));
        // Cumulative completion: an entry counts as "past stage i" if its status is at i or later.
        // The earliest-reached stage = the smallest bucket index that contains any entry.
        // The pipeline's "current active" stage = lowest bucket index with a count > 0 that isn't fully past it.
        // Simpler: progress per step = entries that have reached or passed that step / total.
        const stepIdxOf = {};
        STAGE_BUCKETS.forEach((b, i) => b.statuses.forEach(st => { stepIdxOf[st] = i; }));
        // For each step, count entries whose stepIdx >= step's index.
        const progress = STAGE_BUCKETS.map((_, i) => {
          let reached = 0;
          for (const e of p.entries) {
            const si = stepIdxOf[e.payment_status];
            if (si != null && si >= i) reached++;
          }
          return reached;
        });
        // The "active step" = the highest step where everyone has reached it but not all reached the next one.
        // i.e. the first step that's not fully completed.
        let activeStep = STAGE_BUCKETS.length - 1;
        for (let i = 0; i < STAGE_BUCKETS.length; i++) {
          if (progress[i] < total) { activeStep = i; break; }
          if (i === STAGE_BUCKETS.length - 1 && progress[i] === total) activeStep = i;
        }
        return { ...p, total, buckets, progress, activeStep };
      })
      .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));

    res.render('shopee/payouts/index', {
      title: 'Shopee Payouts',
      entries, affiliates, rate, rateMeta, deductions, studios, user,
      bankList, myTotals, periodGroups,
      incomingTransfers,
      studioSettlement, idTotals,
      pendingDistributions,
      studioPeriods, studioKpi
    });
  },

  // ── Upload Shopee invoices (OCR) ────────────────────────────────
  async postUpload(req, res) {
    const files = req.files || [];
    if (!files.length) {
      req.flash('error', 'No files selected.');
      return res.redirect('/shopee/payouts');
    }

    const user = req.session.user;
    const studioId = ['superadmin','indonesia_admin'].includes(user.role) ? (req.body.studio_id || null) : (user.role === 'studio' ? user.studio_id : null);
    const rate = await getRate();
    const results = await extractMultiplePayouts(files.map(f => f.path));
    let added = 0;
    let errors = [];
    let skipped = 0;
    let warnings = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.error) { errors.push(`${r.file}: ${r.error}`); continue; }

      // Duplicate check by invoice number
      if (r.invoice_number) {
        const existing = await PayoutEntry.findByInvoiceNumber(r.invoice_number);
        if (existing) { skipped++; continue; }
      }

      // Auto-link by name (studio-scoped if studio user)
      let affiliateId = null;
      if (r.supplier_name) {
        let aff;
        if (studioId) {
          aff = await Affiliate.findByNameAndStudio(r.supplier_name, studioId);
          if (!aff) {
            // Check if name exists globally but not in this studio
            const globalAff = await Affiliate.findByName(r.supplier_name);
            if (globalAff) {
              warnings.push(`"${r.supplier_name}" exists but belongs to another studio.`);
            } else {
              warnings.push(`"${r.supplier_name}" does not match any of your studio's affiliates.`);
            }
          }
        } else {
          aff = await Affiliate.findByName(r.supplier_name);
        }
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
        invoice_number: r.invoice_number || null,
        invoice_file_path: `/uploads/shopee-invoices/${files[i].filename}`,
        invoice_date: isoDate,
        period_description: r.period_description || null,
        payout_amount: myr,
        tax_amount: parseFloat(r.tax_amount) || 0,
        payout_amount_idr: Math.round(myr * rate),
        created_by: user.id
      });
      added++;
    }

    if (errors.length) req.flash('error', `${errors.length} file(s) failed: ${errors.join('; ')}`);
    if (skipped) req.flash('error', `${skipped} duplicate(s) skipped (invoice already exists).`);
    if (warnings.length) req.flash('error', `⚠ ${warnings.join(' | ')}`);
    if (added) req.flash('success', `${added} payout(s) extracted and saved.`);
    else if (!errors.length && !skipped) req.flash('error', 'No valid invoices found.');
    res.redirect('/shopee/payouts');
  },

  // ── Manual entry ────────────────────────────────────────────────
  async postManualEntry(req, res) {
    const { payout_amount, tax_amount, invoice_date, affiliate_account_id, period_description } = req.body;
    const rate = await getRate();
    const myr = parseFloat(payout_amount) || 0;

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
    // Studio users can only view their own entries
    const user = req.session.user;
    if (user.role === 'studio' && entry.studio_id !== user.studio_id) {
      req.flash('error', 'Access denied.'); return res.redirect('/shopee/payouts');
    }
    const rateMeta = await getRateMeta();
    const rate = rateMeta.value;
    const deductions = await getDeductions();
    res.render('shopee/payouts/detail', {
      title: `Payout — ${entry.affiliate_name || entry.extracted_name}`,
      entry, rate, rateMeta, deductions, user
    });
  },

  // ── Status transitions ──────────────────────────────────────────
  // Valid transitions:
  //   processing  → collected     (MY admin)
  //   collected   → transferring  (MY admin)
  //   transferring→ received      (ID admin)
  //   received    → distributed   (ID admin)
  //   distributed → completed     (studio)

  async postUpdateStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    const user = req.session.user;
    const role = user.role;

    // Permission matrix (forward + rollback)
    const allowed = {
      'processing':   ['malaysia_admin', 'superadmin'],
      'collected':    ['malaysia_admin', 'superadmin'],
      'transferring': ['malaysia_admin', 'superadmin'],
      'received':     ['indonesia_admin', 'superadmin'],
      'distributed':  ['indonesia_admin', 'superadmin'],
      'completed':    ['studio', 'superadmin'],
    };

    // Valid transitions (forward + rollback)
    const validTransitions = {
      'processing':   ['collected'],
      'collected':    ['processing', 'transferring'],
      'transferring': ['collected', 'received'],
      'received':     ['transferring', 'distributed'],
      'distributed':  ['received', 'completed'],
      'completed':    ['distributed'],
    };

    if (!allowed[status] || !allowed[status].includes(role)) {
      req.flash('error', `You don't have permission to set status to "${status}".`);
      return res.redirect('/shopee/payouts');
    }

    // Check transition is valid
    const entry = await PayoutEntry.findById(id);
    if (!entry) { req.flash('error', 'Entry not found.'); return res.redirect('/shopee/payouts'); }
    const currentValid = validTransitions[entry.payment_status] || [];
    if (!currentValid.includes(status)) {
      req.flash('error', `Cannot change from "${entry.payment_status}" to "${status}".`);
      return res.redirect('/shopee/payouts');
    }

    // Proof required for transferring and distributed
    let proofPath = null;
    if ((status === 'transferring' || status === 'distributed') && req.file) {
      proofPath = `/uploads/proofs/${req.file.filename}`;
    }

    if (status === 'transferring' && !proofPath) {
      req.flash('error', 'Transfer proof is required when marking as transferring.');
      return res.redirect('/shopee/payouts');
    }
    if (status === 'distributed' && !proofPath) {
      req.flash('error', 'Payment proof is required when distributing to studio.');
      return res.redirect('/shopee/payouts');
    }

    await PayoutEntry.updateStatus(id, status, user.id, proofPath);

    const labels = {
      collected: 'Marked as collected',
      transferring: 'Marked as transferring to Indonesia (proof attached)',
      received: 'Confirmed money received in Indonesia',
      distributed: 'Money distributed to studio (proof attached)',
      completed: 'Confirmed received — completed!'
    };

    req.flash('success', labels[status] || `Status updated to ${status}`);
    res.redirect('/shopee/payouts');
  },

  // ── Delete entry ────────────────────────────────────────────────
  async postDelete(req, res) {
    await PayoutEntry.deleteById(req.params.id);
    req.flash('success', 'Entry deleted.');
    res.redirect('/shopee/payouts');
  },

  // ── Bulk Transfer ──────────────────────────────────────────────
  async getTransfer(req, res) {
    const { from, to } = req.query;
    const db = require('../config/database');
    let where = `pe.payment_status = 'collected'`;
    const params = [];
    if (from) { where += ' AND pe.invoice_date >= ?'; params.push(from); }
    if (to)   { where += ' AND pe.invoice_date <= ?'; params.push(to); }

    const [entries] = await db.query(`
      SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      WHERE ${where}
      ORDER BY pe.invoice_date ASC, pe.created_at ASC
    `, params);

    const deductions = await getDeductions();
    const rateMeta = await getRateMeta();
    const rate = rateMeta.value;
    res.render('shopee/payouts/transfer', {
      title: 'Bulk Transfer',
      entries, deductions, rate, rateMeta, query: req.query, user: req.session.user
    });
  },

  // ── Bulk Collect (MY admin / SA) ──────────────────────────────
  async postBulkCollect(req, res) {
    const user = req.session.user;
    if (!['malaysia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to bulk-collect.');
      return res.redirect('/shopee/payouts');
    }
    let { entry_ids } = req.body;
    if (!entry_ids) { req.flash('error', 'No payouts selected.'); return res.redirect('/shopee/payouts'); }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    const ids = entry_ids.map(Number).filter(Boolean);
    if (!ids.length) { req.flash('error', 'No valid payouts selected.'); return res.redirect('/shopee/payouts'); }
    const db = require('../config/database');
    const [result] = await db.query(
      `UPDATE payout_entries
       SET payment_status='collected', payment_time=NOW(), collected_by=?
       WHERE id IN (${ids.map(()=>'?').join(',')}) AND payment_status='processing'`,
      [user.id, ...ids]
    );
    const skipped = ids.length - result.affectedRows;
    req.flash('success', `${result.affectedRows} marked as collected${skipped ? ` · ${skipped} skipped (wrong status)` : ''}.`);
    res.redirect('/shopee/payouts');
  },

  // ── Bulk Confirm received by studio (studio / SA) ──────────────
  async postBulkConfirm(req, res) {
    const user = req.session.user;
    if (!['studio','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to confirm receipt.');
      return res.redirect('/shopee/payouts');
    }
    let { entry_ids } = req.body;
    if (!entry_ids) { req.flash('error', 'No entries selected.'); return res.redirect('/shopee/payouts'); }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    const ids = entry_ids.map(Number).filter(Boolean);
    if (!ids.length) { req.flash('error', 'No valid entries selected.'); return res.redirect('/shopee/payouts'); }
    const db = require('../config/database');
    // Studio users limited to their own studio's entries
    const studioId = user.role === 'studio' ? user.studio_id : null;
    let where = `id IN (${ids.map(()=>'?').join(',')}) AND payment_status='distributed'`;
    const params = [...ids];
    if (studioId) {
      where += ` AND affiliate_account_id IN (SELECT id FROM affiliate_accounts WHERE studio_id = ?)`;
      params.push(studioId);
    }
    const [result] = await db.query(
      `UPDATE payout_entries SET payment_status='completed' WHERE ${where}`,
      params
    );
    const skipped = ids.length - result.affectedRows;
    req.flash('success', `${result.affectedRows} confirmed${skipped ? ` · ${skipped} skipped` : ''}.`);
    res.redirect('/shopee/payouts');
  },

  // ── Bulk Receive (ID admin / SA) ───────────────────────────────
  async postBulkReceive(req, res) {
    const user = req.session.user;
    if (!['indonesia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to bulk-receive.');
      return res.redirect('/shopee/payouts');
    }
    let { entry_ids } = req.body;
    if (!entry_ids) { req.flash('error', 'No payouts selected.'); return res.redirect('/shopee/payouts'); }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    const ids = entry_ids.map(Number).filter(Boolean);
    if (!ids.length) { req.flash('error', 'No valid payouts selected.'); return res.redirect('/shopee/payouts'); }
    const db = require('../config/database');
    const [result] = await db.query(
      `UPDATE payout_entries
       SET payment_status='received'
       WHERE id IN (${ids.map(()=>'?').join(',')}) AND payment_status='transferring'`,
      ids
    );
    const skipped = ids.length - result.affectedRows;
    req.flash('success', `${result.affectedRows} marked as received${skipped ? ` · ${skipped} skipped (wrong status)` : ''}.`);
    res.redirect('/shopee/payouts');
  },

  // ── Bank-grouped collect with actual amount (MY admin / SA) ────
  // Body: entry_ids[] (all entries from one bank batch), actual_total_myr (number)
  // Distributes the actual total proportionally across entries' netToTransfer
  // and stores per-entry actual_collected_myr, then flips status to 'collected'.
  async postCollectBank(req, res) {
    const user = req.session.user;
    if (!['malaysia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to bulk-collect.');
      return res.redirect('/shopee/payouts');
    }
    let { entry_ids, actual_total_myr } = req.body;
    if (!entry_ids) { req.flash('error', 'No entries selected.'); return res.redirect('/shopee/payouts'); }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    const ids = entry_ids.map(Number).filter(Boolean);
    if (!ids.length) { req.flash('error', 'No valid entries selected.'); return res.redirect('/shopee/payouts'); }

    const actualTotal = parseFloat(actual_total_myr);
    if (!Number.isFinite(actualTotal) || actualTotal < 0) {
      req.flash('error', 'Invalid actual amount.');
      return res.redirect('/shopee/payouts');
    }

    const db = require('../config/database');
    // Re-fetch the entries (eligible only) so we know each one's gross
    const [rows] = await db.query(
      `SELECT id, payout_amount FROM payout_entries
       WHERE id IN (${ids.map(()=>'?').join(',')}) AND payment_status='processing'`,
      ids
    );
    if (!rows.length) {
      req.flash('error', 'No matching processing entries.');
      return res.redirect('/shopee/payouts');
    }

    const deductions = await getDeductions();
    // Compute each entry's net-to-transfer (the slice the bank holder owes back)
    const slices = rows.map(r => {
      const b = breakdownEntry({ payout_amount: r.payout_amount }, deductions);
      return { id: r.id, expected: b.needToPay };
    });
    const totalExpected = slices.reduce((s, x) => s + x.expected, 0) || 1;

    // Distribute proportionally
    let allocated = 0;
    const updates = slices.map((s, i) => {
      let actual;
      if (i === slices.length - 1) {
        // Last entry absorbs rounding difference
        actual = +(actualTotal - allocated).toFixed(2);
      } else {
        actual = +((s.expected / totalExpected) * actualTotal).toFixed(2);
        allocated += actual;
      }
      return { id: s.id, actual };
    });

    // Apply updates one by one (small batch — typically a few entries per bank)
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const u of updates) {
        await conn.query(
          `UPDATE payout_entries
           SET payment_status='collected', payment_time=NOW(), collected_by=?, actual_collected_myr=?
           WHERE id=? AND payment_status='processing'`,
          [user.id, u.actual, u.id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      req.flash('error', 'Failed to record collection: ' + err.message);
      return res.redirect('/shopee/payouts');
    } finally {
      conn.release();
    }

    const skipped = ids.length - updates.length;
    req.flash('success',
      `Collected ${updates.length} entries (MYR ${actualTotal.toFixed(2)})${skipped ? ` · ${skipped} skipped` : ''}.`);
    res.redirect('/shopee/payouts');
  },

  // ── Collect entire payout period (MY admin / SA) ────────────────
  // Marks every `processing` entry for the given invoice_date as collected,
  // using each entry's expected needToPay as the actual_collected_myr.
  // Use case: MY admin physically collected from all bank holders for a Shopee
  // payout cycle in one go and wants to flip the entire period in one click.
  async postCollectPeriod(req, res) {
    const user = req.session.user;
    if (!['malaysia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to bulk-collect.');
      return res.redirect('/shopee/payouts');
    }
    const { invoice_date } = req.body;
    if (!invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) {
      req.flash('error', 'Invalid invoice date.');
      return res.redirect('/shopee/payouts');
    }

    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT id, payout_amount FROM payout_entries
       WHERE payment_status='processing' AND invoice_date = ?`,
      [invoice_date]
    );
    if (!rows.length) {
      req.flash('error', `No pending invoices found for ${invoice_date}.`);
      return res.redirect('/shopee/payouts');
    }

    const deductions = await getDeductions();
    const conn = await db.getConnection();
    let updated = 0;
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        const b = breakdownEntry({ payout_amount: r.payout_amount }, deductions);
        await conn.query(
          `UPDATE payout_entries
           SET payment_status='collected', payment_time=NOW(), collected_by=?, actual_collected_myr=?
           WHERE id=? AND payment_status='processing'`,
          [user.id, +b.needToPay.toFixed(2), r.id]
        );
        updated++;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      req.flash('error', 'Failed to collect period: ' + err.message);
      return res.redirect('/shopee/payouts');
    } finally {
      conn.release();
    }

    const [y, m, d] = invoice_date.split('-');
    req.flash('success', `Collected ${updated} entries for payout ${d}/${m}/${y} at expected amounts.`);
    res.redirect('/shopee/payouts');
  },

  // ── Mark all collected entries in a period as transferred (MY admin / SA) ──
  // Body: invoice_date (YYYY-MM-DD), actual_total_myr (number — what actually
  // landed in ID admin's account). The actual amount is split proportionally
  // across the batch's entries based on each entry's expected netToTransfer.
  // If actual < expected, ID admin's commission AND each studio's share both
  // shrink proportionally on the next distribution step.
  async postTransferPeriod(req, res) {
    const user = req.session.user;
    if (!['malaysia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to bulk-transfer.');
      return res.redirect('/shopee/payouts');
    }
    const { invoice_date, actual_total_myr } = req.body;
    if (!invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) {
      req.flash('error', 'Invalid invoice date.');
      return res.redirect('/shopee/payouts');
    }

    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT id, payout_amount, actual_collected_myr FROM payout_entries
       WHERE payment_status='collected' AND invoice_date = ?`,
      [invoice_date]
    );
    if (!rows.length) {
      req.flash('error', `No collected entries found for ${invoice_date}.`);
      return res.redirect('/shopee/payouts');
    }

    const deductions = await getDeductions();
    // Per-entry expected netToTransfer (= what should reach ID admin).
    const slices = rows.map(r => {
      const b = breakdownEntry({ payout_amount: r.payout_amount }, deductions);
      // If actual collected was recorded, recompute the expected based on it
      // (collected − MY admin − MY HQ − Shopee − SST). Otherwise use the canonical
      // breakdownEntry netToTransfer.
      let expected;
      if (r.actual_collected_myr != null) {
        expected = parseFloat(r.actual_collected_myr) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
      } else {
        expected = b.netToTransfer;
      }
      return { id: r.id, expected: Math.max(0, expected) };
    });
    const totalExpected = slices.reduce((s, x) => s + x.expected, 0) || 1;

    // Actual total: default to expected if not provided.
    const parsedActual = parseFloat(actual_total_myr);
    const actualTotal = Number.isFinite(parsedActual) && parsedActual > 0 ? parsedActual : totalExpected;

    // Proportional allocation; last entry absorbs rounding.
    let allocated = 0;
    const updates = slices.map((s, i) => {
      let received;
      if (i === slices.length - 1) {
        received = +(actualTotal - allocated).toFixed(2);
      } else {
        received = +((s.expected / totalExpected) * actualTotal).toFixed(2);
        allocated += received;
      }
      return { id: s.id, received };
    });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const u of updates) {
        await conn.query(
          `UPDATE payout_entries
           SET payment_status='transferring', actual_received_myr=?
           WHERE id=? AND payment_status='collected'`,
          [u.received, u.id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      req.flash('error', 'Failed to mark transferred: ' + err.message);
      return res.redirect('/shopee/payouts');
    } finally {
      conn.release();
    }

    const [y, m, d] = invoice_date.split('-');
    const delta = actualTotal - totalExpected;
    let msg = `Marked ${updates.length} entries as transferred (MYR ${actualTotal.toFixed(2)}) for payout ${d}/${m}/${y}.`;
    if (Math.abs(delta) > 0.01) {
      msg += delta < 0
        ? ` Shortfall of MYR ${Math.abs(delta).toFixed(2)} will be split proportionally on distribution.`
        : ` Surplus of MYR ${delta.toFixed(2)} will be split proportionally on distribution.`;
    }
    req.flash('success', msg);
    res.redirect('/shopee/payouts');
  },

  // ── Mark all transferring entries in a period as received (ID admin / SA) ──
  // Body: invoice_date (YYYY-MM-DD). Bulk-flips every 'transferring' entry for
  // that Shopee payout cycle to 'received' in one click.
  async postReceivePeriod(req, res) {
    const user = req.session.user;
    if (!['indonesia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to confirm received.');
      return res.redirect('/shopee/payouts');
    }
    const { invoice_date } = req.body;
    if (!invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) {
      req.flash('error', 'Invalid invoice date.');
      return res.redirect('/shopee/payouts');
    }
    const db = require('../config/database');
    const [result] = await db.query(
      `UPDATE payout_entries SET payment_status='received'
       WHERE payment_status='transferring' AND invoice_date = ?`,
      [invoice_date]
    );
    if (result.affectedRows === 0) {
      req.flash('error', `No transferring entries found for ${invoice_date}.`);
      return res.redirect('/shopee/payouts');
    }
    const [y,m,d] = invoice_date.split('-');
    req.flash('success', `Marked ${result.affectedRows} entries as received for payout ${d}/${m}/${y}.`);
    res.redirect('/shopee/payouts');
  },

  // ── Distribute an entire payout period to all studios at once (ID admin / SA) ──
  // Body: invoice_date, actual_rate (FX), id_deduction_pct.
  // For every 'received' entry in this Shopee payout cycle, applies the FX rate +
  // ID admin slice and flips status to 'distributed'. One bank conversion → one rate.
  async postDistributePeriod(req, res) {
    const user = req.session.user;
    if (!['indonesia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to distribute.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    const { invoice_date, actual_rate, id_deduction_pct } = req.body;
    if (!invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) {
      req.flash('error', 'Invalid invoice date.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    const fxRate = parseFloat(actual_rate);
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      req.flash('error', 'Actual transfer FX rate is required.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    const idPct = Number.isFinite(parseFloat(id_deduction_pct)) ? parseFloat(id_deduction_pct) : 0;

    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT id, payout_amount, actual_collected_myr, actual_received_myr FROM payout_entries
       WHERE payment_status='received' AND invoice_date = ?`,
      [invoice_date]
    );
    if (!rows.length) {
      req.flash('error', `No received entries found for ${invoice_date}.`);
      return res.redirect('/shopee/payouts/studio-payments');
    }

    const deductions = await getDeductions();
    // Need affiliate_account → studio_id mapping to group by studio (one bank fee per studio).
    const db2 = require('../config/database');
    const ids = rows.map(r => r.id);
    const [rowsWithStudio] = await db2.query(
      `SELECT pe.id, pe.payout_amount, pe.actual_collected_myr, pe.actual_received_myr,
              a.studio_id
       FROM payout_entries pe
       LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
       WHERE pe.id IN (${ids.map(()=>'?').join(',')})`,
      ids
    );

    // Group rows by studio so we can deduct one bank fee per studio.
    const byStudio = {};
    for (const r of rowsWithStudio) {
      const k = r.studio_id ?? 'unassigned';
      (byStudio[k] ||= []).push(r);
    }

    const conn = await db.getConnection();
    let updated = 0;
    try {
      await conn.beginTransaction();
      for (const [studioKey, studioRows] of Object.entries(byStudio)) {
        // First pass: per entry compute studioShareMyr (canonical formula).
        const perEntry = [];
        let totalStudioShareMyr = 0;
        for (const r of studioRows) {
          const gross = parseFloat(r.payout_amount) || 0;
          const b = breakdownEntry({ payout_amount: r.payout_amount }, deductions);
          let received;
          if (r.actual_received_myr != null) {
            received = parseFloat(r.actual_received_myr);
          } else if (r.actual_collected_myr != null) {
            received = parseFloat(r.actual_collected_myr) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
          } else {
            received = b.netToTransfer;
          }
          // Canonical: ID admin = gross × idPct%, scaled when actual_received differs.
          const ratio = b.netToTransfer > 0 ? received / b.netToTransfer : 1;
          const idAdminMyr = gross * (idPct / 100) * ratio;
          const studioShareMyr = Math.max(0, received - idAdminMyr);
          perEntry.push({ id: r.id, studioShareMyr });
          totalStudioShareMyr += studioShareMyr;
        }
        // Total IDR for this studio, less one bank fee, floored to 100.
        const totalIdrBeforeFee = totalStudioShareMyr * fxRate;
        const totalIdrAfterFee  = floorIDR(Math.max(0, totalIdrBeforeFee - BANK_FEE_IDR_PER_STUDIO));

        // Distribute the post-fee total across entries proportionally; floor each
        // and let the last entry absorb rounding so the per-entry sum equals the total.
        let allocated = 0;
        for (let i = 0; i < perEntry.length; i++) {
          let entryIdr;
          if (i === perEntry.length - 1) {
            entryIdr = floorIDR(totalIdrAfterFee - allocated);
          } else {
            const share = totalStudioShareMyr > 0 ? perEntry[i].studioShareMyr / totalStudioShareMyr : 0;
            entryIdr = floorIDR(totalIdrAfterFee * share);
            allocated += entryIdr;
          }
          await conn.query(
            `UPDATE payout_entries
             SET payment_status='distributed', actual_distributed_idr=?, actual_fx_rate=?
             WHERE id=? AND payment_status='received'`,
            [entryIdr, fxRate, perEntry[i].id]
          );
          updated++;
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      req.flash('error', 'Failed to distribute period: ' + err.message);
      return res.redirect('/shopee/payouts/studio-payments');
    } finally {
      conn.release();
    }

    const [y,m,d] = invoice_date.split('-');
    const studioCount = Object.keys(byStudio).length;
    req.flash('success', `Distributed ${updated} entries to ${studioCount} studio${studioCount === 1 ? '' : 's'} for payout ${d}/${m}/${y} at FX ${fxRate} (bank fee IDR ${BANK_FEE_IDR_PER_STUDIO.toLocaleString('id-ID')} per studio).`);
    res.redirect('/shopee/payouts/studio-payments');
  },

  async postBulkTransfer(req, res) {
    let { entry_ids } = req.body;
    if (!entry_ids) {
      req.flash('error', 'No payouts selected.');
      return res.redirect('/shopee/payouts/transfer');
    }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    if (!req.file) {
      req.flash('error', 'Transfer proof is required.');
      return res.redirect('/shopee/payouts/transfer');
    }
    const proofPath = `/uploads/proofs/${req.file.filename}`;
    const db = require('../config/database');
    const ids = entry_ids.map(Number).filter(Boolean);
    if (ids.length === 0) {
      req.flash('error', 'No valid payouts selected.');
      return res.redirect('/shopee/payouts/transfer');
    }
    await db.query(
      `UPDATE payout_entries SET payment_status='transferring', transfer_proof_path=? WHERE id IN (${ids.map(()=>'?').join(',')}) AND payment_status='collected'`,
      [proofPath, ...ids]
    );
    req.flash('success', `${ids.length} payout(s) marked as transferring.`);
    res.redirect('/shopee/payouts');
  },

  // ── Currency converter ──────────────────────────────────────────
  async getConverter(req, res) {
    const rate = await getRate();
    res.render('shopee/converter', { title: 'Currency Converter', myrToIdr: rate, idrToMyr: 1 / rate, user: req.session.user });
  },

  // ── Studio Payments (ID admin + SA) ─────────────────────────────
  // Stacked period → studios layout. One Shopee payout cycle = one period card.
  // Inside each period, one row per studio with "to transfer" amount. Period header
  // takes a single FX rate which is applied to every studio in that period (because
  // ID admin converts the whole MY admin transfer at one rate before disbursing).
  async getStudioPayments(req, res) {
    const user = req.session.user;
    if (!['indonesia_admin','superadmin'].includes(user.role)) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'Only Indonesia admin can view studio payments.',
        user
      });
    }
    const db = require('../config/database');

    // Pending pool: every 'received' entry, grouped by Shopee payout cycle (invoice_date) → studio.
    // We pull the studio's bank details so ID admin can transfer without leaving the app.
    const [entries] = await db.query(`
      SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number, a.studio_id,
             s.name AS studio_name,
             s.bank_name           AS studio_bank_name,
             s.bank_account_holder AS studio_bank_account_holder,
             s.bank_account_number AS studio_bank_account_number
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      LEFT JOIN studios s ON a.studio_id = s.id
      WHERE pe.payment_status = 'received'
      ORDER BY pe.invoice_date DESC, s.name, a.full_name
    `);

    const deductions = await getDeductions();
    const rateMeta = await getRateMeta();
    const rate = rateMeta.value;

    const periodMap = {};
    for (const e of entries) {
      const k = dateKey(e.invoice_date);
      const period = periodMap[k] ||= {
        invoice_date: k === 'undated' ? null : k,
        studios: {},
        totalEntries: 0,
        totalReceivedMyr: 0,
        totalToStudioMyr: 0,
        totalIdAdminMyr: 0,
        periodDescriptions: new Set(),
        lastFxRate: null,
      };
      if (e.period_description) period.periodDescriptions.add(e.period_description);

      const sk = e.studio_id ?? 'unassigned';
      const s = period.studios[sk] ||= {
        studio_id: e.studio_id,
        studio_name: e.studio_name || 'Unassigned',
        studio_bank_name:           e.studio_bank_name           || null,
        studio_bank_account_holder: e.studio_bank_account_holder || null,
        studio_bank_account_number: e.studio_bank_account_number || null,
        entries: [], count: 0,
        receivedMyr: 0, idAdminMyr: 0, toStudioMyr: 0,
      };

      const b = breakdownEntry(e, deductions);
      // What landed in ID admin's hands for this entry — prefer actual.
      const received = e.actual_received_myr != null
        ? parseFloat(e.actual_received_myr)
        : b.netToTransfer;
      // Scale the studio + ID admin slices proportionally if actual_received differs from expected.
      const ratio = (e.actual_received_myr != null && b.netToTransfer > 0)
        ? parseFloat(e.actual_received_myr) / b.netToTransfer
        : 1;
      const studioNet = b.netToStudio * ratio;
      const idAdmin   = b.idAdminFee  * ratio;

      s.entries.push({ ...e, breakdown: b, receivedMyr: received, studioNet, idAdmin });
      s.count++;
      s.receivedMyr  += received;
      s.idAdminMyr   += idAdmin;
      s.toStudioMyr  += studioNet;

      period.totalEntries++;
      period.totalReceivedMyr  += received;
      period.totalToStudioMyr  += studioNet;
      period.totalIdAdminMyr   += idAdmin;
    }

    // Per-period last-used FX rate (suggests a sensible default for the input)
    for (const p of Object.values(periodMap)) {
      if (!p.invoice_date) continue;
      const [rows] = await db.query(`
        SELECT actual_fx_rate, MAX(updated_at) AS at
        FROM payout_entries
        WHERE invoice_date = ? AND actual_fx_rate IS NOT NULL
        GROUP BY actual_fx_rate
        ORDER BY at DESC LIMIT 1
      `, [p.invoice_date]);
      p.lastFxRate = rows[0] ? parseFloat(rows[0].actual_fx_rate) : null;
    }

    const periods = Object.values(periodMap)
      .map(p => ({
        ...p,
        periodDescriptions: [...p.periodDescriptions],
        studios: Object.values(p.studios).sort((a, b) => b.toStudioMyr - a.toStudioMyr),
      }))
      .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));

    // Hero KPIs (pool-wide across all pending periods)
    const kpi = periods.reduce((acc, p) => ({
      totalEntries:     acc.totalEntries     + p.totalEntries,
      totalReceivedMyr: acc.totalReceivedMyr + p.totalReceivedMyr,
      totalToStudioMyr: acc.totalToStudioMyr + p.totalToStudioMyr,
      totalIdAdminMyr:  acc.totalIdAdminMyr  + p.totalIdAdminMyr,
      studioCount:      acc.studioCount + p.studios.length,
    }), { totalEntries: 0, totalReceivedMyr: 0, totalToStudioMyr: 0, totalIdAdminMyr: 0, studioCount: 0 });

    // Recent distinct FX rates the ID admin has actually used (helps pick a sensible rate)
    const [recentFxRows] = await db.query(`
      SELECT DISTINCT actual_fx_rate, MAX(updated_at) AS used_at
      FROM payout_entries
      WHERE actual_fx_rate IS NOT NULL
      GROUP BY actual_fx_rate
      ORDER BY used_at DESC
      LIMIT 5
    `);
    const recentFxRates = recentFxRows.map(r => ({
      rate: parseFloat(r.actual_fx_rate),
      used_at: r.used_at,
    }));

    // ── Paid history (distributed + completed entries, last 90 days) ──
    const [historyEntries] = await db.query(`
      SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number, a.studio_id,
             s.name AS studio_name
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      LEFT JOIN studios s ON a.studio_id = s.id
      WHERE pe.payment_status IN ('distributed','completed')
        AND pe.updated_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      ORDER BY pe.updated_at DESC
    `);

    const historyMap = {};
    for (const e of historyEntries) {
      const key = e.period_description || (e.invoice_date ? `Invoice ${dateKey(e.invoice_date).split('-').reverse().join('/')}` : 'Undated');
      const idr = e.actual_distributed_idr != null ? parseFloat(e.actual_distributed_idr) : 0;
      const grp = historyMap[key] ||= {
        periodLabel: key, entries: [], totalIdr: 0,
        studioCount: new Set(), latestDistributedAt: e.updated_at,
      };
      grp.entries.push(e);
      grp.totalIdr += idr;
      grp.studioCount.add(e.studio_id ?? 'unassigned');
      if (e.updated_at && (!grp.latestDistributedAt || e.updated_at > grp.latestDistributedAt)) {
        grp.latestDistributedAt = e.updated_at;
      }
    }
    const paidHistory = Object.values(historyMap)
      .map(g => ({ ...g, studioCount: g.studioCount.size }))
      .sort((a, b) => (b.latestDistributedAt || 0) - (a.latestDistributedAt || 0));

    res.render('shopee/payouts/studio-payments', {
      title: 'Studio Payments',
      periods, kpi, recentFxRates, paidHistory,
      rate, rateMeta, deductions, user,
      bankFeeIdr: BANK_FEE_IDR_PER_STUDIO,
    });
  },

  async postDistributeStudio(req, res) {
    const user = req.session.user;
    if (!['indonesia_admin','superadmin'].includes(user.role)) {
      req.flash('error', 'You do not have permission to distribute payments.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    let { entry_ids, actual_rate, id_deduction_pct } = req.body;
    if (!entry_ids) {
      req.flash('error', 'No entries selected.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    if (!Array.isArray(entry_ids)) entry_ids = [entry_ids];
    const ids = entry_ids.map(Number).filter(Boolean);
    if (!ids.length) {
      req.flash('error', 'No valid entries selected.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    const fxRate = parseFloat(actual_rate);
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      req.flash('error', 'Actual transfer FX rate is required.');
      return res.redirect('/shopee/payouts/studio-payments');
    }
    const idPct = Number.isFinite(parseFloat(id_deduction_pct)) ? parseFloat(id_deduction_pct) : 0;

    // Proof file is now optional (set when present, ignored otherwise).
    const proofPath = req.file ? `/uploads/proofs/${req.file.filename}` : null;
    const db = require('../config/database');

    // Re-fetch each entry to compute studio's IDR share using the actual rate
    const [rows] = await db.query(
      `SELECT id, payout_amount, actual_collected_myr, actual_received_myr FROM payout_entries
       WHERE id IN (${ids.map(()=>'?').join(',')}) AND payment_status='received'`,
      ids
    );
    const deductions = await getDeductions();

    // First pass: per entry compute studio share. Single-studio path so there's
    // one bank fee (BANK_FEE_IDR_PER_STUDIO) deducted from the studio's IDR total.
    const perEntry = [];
    let totalStudioShareMyr = 0;
    for (const r of rows) {
      const gross = parseFloat(r.payout_amount) || 0;
      const b = breakdownEntry({ payout_amount: r.payout_amount }, deductions);
      let received;
      if (r.actual_received_myr != null) {
        received = parseFloat(r.actual_received_myr);
      } else if (r.actual_collected_myr != null) {
        received = parseFloat(r.actual_collected_myr) - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;
      } else {
        received = b.netToTransfer;
      }
      const ratio = b.netToTransfer > 0 ? received / b.netToTransfer : 1;
      const idAdminMyr = gross * (idPct / 100) * ratio;
      const studioShareMyr = Math.max(0, received - idAdminMyr);
      perEntry.push({ id: r.id, studioShareMyr });
      totalStudioShareMyr += studioShareMyr;
    }
    const totalIdrAfterFee = floorIDR(Math.max(0, totalStudioShareMyr * fxRate - BANK_FEE_IDR_PER_STUDIO));

    const conn = await db.getConnection();
    let updated = 0;
    try {
      await conn.beginTransaction();
      let allocated = 0;
      for (let i = 0; i < perEntry.length; i++) {
        let entryIdr;
        if (i === perEntry.length - 1) {
          entryIdr = floorIDR(totalIdrAfterFee - allocated);
        } else {
          const share = totalStudioShareMyr > 0 ? perEntry[i].studioShareMyr / totalStudioShareMyr : 0;
          entryIdr = floorIDR(totalIdrAfterFee * share);
          allocated += entryIdr;
        }
        await conn.query(
          `UPDATE payout_entries
           SET payment_status='distributed',
               distribution_proof_path=?,
               actual_distributed_idr=?,
               actual_fx_rate=?
           WHERE id=? AND payment_status='received'`,
          [proofPath, entryIdr, fxRate, perEntry[i].id]
        );
        updated++;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      req.flash('error', 'Failed to distribute: ' + err.message);
      return res.redirect('/shopee/payouts/studio-payments');
    } finally {
      conn.release();
    }

    const skipped = ids.length - updated;
    req.flash('success', `${updated} entries distributed at FX ${fxRate} (bank fee IDR ${BANK_FEE_IDR_PER_STUDIO.toLocaleString('id-ID')} deducted)${skipped ? ` · ${skipped} skipped` : ''}.`);
    res.redirect('/shopee/payouts/studio-payments');
  },

  // ── Period Report PDF (SA + MY only) ────────────────────────────
  async getPeriodReport(req, res) {
    const user = req.session.user;
    if (!['superadmin', 'malaysia_admin'].includes(user.role)) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to download this report.',
        user
      });
    }
    const period = await PayoutPeriod.findById(req.params.periodId);
    if (!period) {
      req.flash('error', 'Period not found.');
      return res.redirect('/shopee/payouts');
    }
    const db = require('../config/database');
    const [entries] = await db.query(`
      SELECT pe.*, a.full_name AS affiliate_name, a.bank_name, a.account_number, s.name AS studio_name
      FROM payout_entries pe
      LEFT JOIN affiliate_accounts a ON pe.affiliate_account_id = a.id
      LEFT JOIN studios s ON a.studio_id = s.id
      WHERE pe.payout_period_id = ?
      ORDER BY pe.invoice_date ASC, pe.created_at ASC
    `, [period.id]);

    const totals = entries.reduce((acc, e) => {
      const myr = parseFloat(e.payout_amount) || 0;
      acc.totalMyr += myr;
      acc.totalIdr += parseFloat(e.payout_amount_idr) || 0;
      acc.byStatus[e.payment_status] = (acc.byStatus[e.payment_status] || 0) + myr;
      return acc;
    }, { totalMyr: 0, totalIdr: 0, byStatus: {} });

    const rateMeta = await getRateMeta();
    const rate = rateMeta.value;
    const deductions = await getDeductions();
    const filename = `payout-report-${period.period_number}-${Date.now()}.pdf`;
    const outputPath = await renderPDF('payout-report', {
      period, entries, totals, rate, rateMeta, deductions,
      generatedAt: new Date(),
      generatedBy: user
    }, filename);
    res.download(outputPath, `${period.period_number}.pdf`);
  },

  // ── Excel export of MY admin's reconciliation sheet ────────────
  // ?period=YYYY-MM-DD → single-period workbook; omitted → all periods.
  // Allowed for: malaysia_admin, indonesia_admin, superadmin.
  async getExportExcel(req, res) {
    const user = req.session.user;
    if (!['superadmin', 'malaysia_admin', 'indonesia_admin'].includes(user.role)) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to export payouts.',
        user
      });
    }

    const { buildWorkbook, fmtDDMMYY } = require('../services/payoutExcelService');
    const periodKey = (req.query.period || '').trim();

    const allEntries = await PayoutEntry.findAll({});
    const entries = periodKey
      ? allEntries.filter(e => {
          if (!e.invoice_date) return periodKey === 'undated';
          const k = new Date(e.invoice_date);
          if (Number.isNaN(k.getTime())) return false;
          const yyyy = k.getFullYear();
          const mm = String(k.getMonth() + 1).padStart(2, '0');
          const dd = String(k.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}` === periodKey;
        })
      : allEntries;

    if (periodKey && entries.length === 0) {
      req.flash('error', 'No entries found for this period.');
      return res.redirect('/shopee/payouts');
    }

    const rate = await getRate();
    const deductions = await getDeductions();
    const wb = await buildWorkbook({
      entries,
      deductions,
      rate,
      mode: periodKey ? 'period' : 'all',
    });

    const filenameTag = periodKey
      ? fmtDDMMYY(periodKey === 'undated' ? null : periodKey) || 'undated'
      : `all-${fmtDDMMYY(new Date())}`;
    const filename = `payout-portion-${filenameTag}.xlsx`;

    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  }
};

module.exports = payoutController;

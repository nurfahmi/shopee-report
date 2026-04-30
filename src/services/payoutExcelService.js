// Excel export of MY admin's "PORTION PIRIOD" reconciliation sheet.
// Mirrors the manual spreadsheet MY admin keeps: one row per invoice, grouped
// by Shopee payout cycle (invoice_date). Builds one worksheet per period.

const ExcelJS = require('exceljs');
const { breakdownEntry } = require('./payoutCalc');

const fmtDDMMYY  = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
};
const fmtDDDOTMMYYYY = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

// Period dates for the title: "PORTION PIRIOD <invoice-1mo>-<invoice>"
// Mirrors the screenshot's "150326-150426" (Mar 15 → Apr 15 cycle).
function periodTitleRange(invoiceDate) {
  if (!invoiceDate) return 'PORTION PIRIOD';
  const end = new Date(invoiceDate);
  if (Number.isNaN(end.getTime())) return 'PORTION PIRIOD';
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);
  return `PORTION PIRIOD ${fmtDDMMYY(start)}-${fmtDDMMYY(end)}`;
}

// Header columns matching the manual sheet exactly.
const COLUMNS = [
  { key: 'invDate',          header: 'INV DATE',                             width: 12 },
  { key: 'dateReceiveMoney', header: 'DATE RECEIVE MONEY',                   width: 14 },
  { key: 'name',             header: 'NAME',                                 width: 30 },
  { key: 'acctNo',           header: 'ACCT NO',                              width: 30 },
  { key: 'invoiceNo',        header: 'INVOICE NO',                           width: 28 },
  { key: 'needToPay',        header: 'NEED TO PAY BY PERSON',                width: 14 },
  { key: 'totalSale',        header: 'TOTAL SALE ON INV',                    width: 14 },
  { key: 'shopeeFee',        header: 'SHOPEE FEE',                           width: 12 },
  { key: 'sstFee',           header: 'SST FEE',                              width: 12 },
  { key: 'adminFee',         header: 'ADMIN FEE (5%)',                       width: 14 },
  { key: 'hqFee',            header: 'HQ FEE (5%)',                          width: 14 },
  { key: 'perPersonFee',     header: 'PER PERSON FEE 20%',                   width: 14 },
  { key: 'balanceToSupplier',header: 'BALANCE AMOUNT AFTER DEDUCT ALL FEE (PAY TO SUPPLIER INDONESIA)', width: 22 },
  { key: 'receiveAfterShopee', header: 'RECEIVE MONEY TO ACCT AFTER DEDUCT SHOPEE FEE',                 width: 22 },
];

// Style helpers
const moneyFmt = '#,##0.00';
const fillSolid = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
const thinBorder = { style: 'thin', color: { argb: 'FF888888' } };
const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

function buildPeriodSheet(workbook, { invoiceDate, deductions, entries, rate, feeRate, paidDate }) {
  // Worksheet name: a Shopee-cycle short tag (e.g. "150426")
  const shortTag = fmtDDMMYY(invoiceDate) || 'undated';
  const ws = workbook.addWorksheet(shortTag, { properties: { defaultRowHeight: 18 } });

  // Compute the % cells in the header dynamically so they reflect actual settings.
  const adminPct  = `ADMIN FEE (${(deductions.myAdmin || 0)}%)`;
  const hqPct     = `HQ FEE (${(deductions.myHQ || 0)}%)`;
  const perPerson = `PER PERSON FEE ${(deductions.general || 0)}%`;
  const headers = COLUMNS.map(c => c.header);
  headers[9]  = adminPct;
  headers[10] = hqPct;
  headers[11] = perPerson;

  // Row 1: Title bar (merged across all columns)
  ws.addRow([periodTitleRange(invoiceDate)]);
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = periodTitleRange(invoiceDate);
  titleCell.font = { name: 'Calibri', bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = fillSolid('FFE8DEF8');
  titleCell.border = allBorders;
  ws.getRow(1).height = 22;

  // Row 2: blank spacer (matches sheet)
  ws.addRow([]);

  // Row 3: Header row
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = fillSolid('FFEFD7D6');
    cell.border = allBorders;
  });
  headerRow.height = 48;

  // Apply column widths
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // Body rows
  let totals = {
    needToPay: 0, totalSale: 0, shopeeFee: 0, sstFee: 0,
    adminFee: 0, hqFee: 0, perPersonFee: 0,
    balanceToSupplier: 0, receiveAfterShopee: 0,
  };

  for (const e of entries) {
    const b = breakdownEntry(e, deductions);
    const fromHolder = e.actual_collected_myr != null ? parseFloat(e.actual_collected_myr) : b.needToPay;
    const balanceToSupplier = fromHolder - b.myAdminFee - b.myHQFee - b.shopeeService - b.shopeeSST;

    const row = ws.addRow([
      fmtDDDOTMMYYYY(e.invoice_date),
      e.payment_time ? fmtDDDOTMMYYYY(e.payment_time) : '',
      e.affiliate_name || e.extracted_name || '',
      [e.bank_name, e.account_number].filter(Boolean).join(' — '),
      e.invoice_number || '',
      fromHolder,
      b.gross,
      b.shopeeService,
      b.shopeeSST,
      b.myAdminFee,
      b.myHQFee,
      b.bankHolderShare,
      balanceToSupplier,
      b.netAfterShopee,
    ]);
    row.eachCell((cell, colNumber) => {
      cell.border = allBorders;
      cell.font = { size: 10 };
      if (colNumber >= 6) {
        cell.numFmt = moneyFmt;
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.alignment = { horizontal: colNumber <= 2 ? 'center' : 'left', vertical: 'middle' };
      }
    });
    // Highlight the balance-to-supplier column red (matches manual sheet emphasis)
    row.getCell(13).fill = fillSolid('FFE06666');
    row.getCell(13).font = { size: 10, color: { argb: 'FFFFFFFF' }, bold: true };

    totals.needToPay          += fromHolder;
    totals.totalSale          += b.gross;
    totals.shopeeFee          += b.shopeeService;
    totals.sstFee             += b.shopeeSST;
    totals.adminFee           += b.myAdminFee;
    totals.hqFee              += b.myHQFee;
    totals.perPersonFee       += b.bankHolderShare;
    totals.balanceToSupplier  += balanceToSupplier;
    totals.receiveAfterShopee += b.netAfterShopee;
  }

  // TOTAL LOAN row
  const totalRow = ws.addRow([
    '', '', '', '', 'TOTAL LOAN',
    totals.needToPay, totals.totalSale, totals.shopeeFee, totals.sstFee,
    totals.adminFee, totals.hqFee, totals.perPersonFee,
    totals.balanceToSupplier, totals.receiveAfterShopee,
  ]);
  totalRow.eachCell((cell, colNumber) => {
    cell.border = allBorders;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fillSolid('FF7E5485');
    cell.alignment = { horizontal: colNumber === 5 ? 'center' : 'right', vertical: 'middle' };
    if (colNumber >= 6) cell.numFmt = moneyFmt;
  });

  // FEE RATE row — flat fee added on top of Pay-To-Supplier balance.
  const fee = parseFloat(feeRate) || 0;
  const feeRow = ws.addRow([]);
  ws.getCell(feeRow.number, 12).value = 'FEE RATE';
  ws.getCell(feeRow.number, 13).value = fee;
  ws.getCell(feeRow.number, 12).font = { bold: true, size: 10 };
  ws.getCell(feeRow.number, 12).alignment = { horizontal: 'right' };
  ws.getCell(feeRow.number, 13).alignment = { horizontal: 'right' };
  ws.getCell(feeRow.number, 13).numFmt = moneyFmt;
  ws.getCell(feeRow.number, 13).border = allBorders;

  // Final paid row: balanceToSupplier + FEE RATE, with PAID date stamp.
  const lastRow = ws.addRow([]);
  ws.getCell(lastRow.number, 13).value = totals.balanceToSupplier + fee;
  ws.getCell(lastRow.number, 13).numFmt = moneyFmt;
  ws.getCell(lastRow.number, 13).alignment = { horizontal: 'right' };
  ws.getCell(lastRow.number, 13).font = { bold: true, size: 10 };
  ws.getCell(lastRow.number, 13).border = allBorders;
  if (paidDate) {
    ws.getCell(lastRow.number, 14).value = `PAID ${fmtDDMMYY(paidDate)}`;
    ws.getCell(lastRow.number, 14).font = { bold: true, size: 10 };
    ws.getCell(lastRow.number, 14).alignment = { horizontal: 'left' };
  }

  return { totals, sheet: ws };
}

// Group entries by invoice_date (one Shopee payout cycle = one period sheet).
// Returns array of { invoiceDate, entries, paidDate } sorted desc by date.
function groupByInvoiceDate(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.invoice_date ? new Date(e.invoice_date).toISOString().slice(0, 10) : 'undated';
    if (!groups.has(key)) groups.set(key, { invoiceDate: e.invoice_date || null, entries: [], paidDate: null });
    const g = groups.get(key);
    g.entries.push(e);
    // Most recent payment_time across the group → "paid" stamp.
    if (e.payment_time) {
      const t = new Date(e.payment_time);
      if (!g.paidDate || t > new Date(g.paidDate)) g.paidDate = e.payment_time;
    }
  }
  return [...groups.values()].sort((a, b) =>
    String(b.invoiceDate || '').localeCompare(String(a.invoiceDate || '')));
}

async function buildWorkbook({ entries, deductions, rate, feeRate = 10, mode = 'all' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ISH Invoice System';
  wb.created = new Date();

  const groups = groupByInvoiceDate(entries);

  if (mode === 'period') {
    // Caller passed a single-period entry list; render one sheet.
    const g = groups[0] || { invoiceDate: null, entries, paidDate: null };
    buildPeriodSheet(wb, { invoiceDate: g.invoiceDate, deductions, entries: g.entries, rate, feeRate, paidDate: g.paidDate });
  } else {
    // All periods: one worksheet per invoice_date, newest first.
    if (groups.length === 0) {
      buildPeriodSheet(wb, { invoiceDate: null, deductions, entries: [], rate, feeRate, paidDate: null });
    } else {
      for (const g of groups) {
        buildPeriodSheet(wb, { invoiceDate: g.invoiceDate, deductions, entries: g.entries, rate, feeRate, paidDate: g.paidDate });
      }
    }
  }
  return wb;
}

module.exports = { buildWorkbook, periodTitleRange, fmtDDMMYY };

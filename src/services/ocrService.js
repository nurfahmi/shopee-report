const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

/**
 * Extract payout data from Shopee Self-Billed E-Invoice PDF.
 * No AI needed — pure text parsing.
 * Returns: { supplier_name, invoice_date, tax_amount, net_payable, period_description }
 */
async function extractPayoutFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') throw new Error('Only PDF files supported.');

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text = data.text.replace(/\r\n/g, '\n');

  // Normalize whitespace for regex (PDFs often break lines mid-sentence)
  const normalized = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  // Supplier Name
  const supplierMatch = normalized.match(/Supplier\s*Name\s*([A-Z][A-Z\s.'@\/()-]+?)(?=Invoice\s*No|Supplier\s*Registration)/);
  const supplier_name = supplierMatch ? supplierMatch[1].trim() : null;

  // Invoice Date
  const dateMatch = normalized.match(/Invoice\s*Date\s*(\d{2}\/\d{2}\/\d{4})/);
  const invoice_date = dateMatch ? dateMatch[1] : null;

  // Net Payable
  const netMatch = normalized.match(/Net\s*Payable[\s\-]*([\d,]+\.\d{2})/);
  const net_payable = netMatch ? parseFloat(netMatch[1].replace(/,/g, '')) : 0;

  // Tax Amount (from total row)
  let tax_amount = 0;
  const taxMatch = normalized.match(/Tax\s*Amount\s*Total\s*Including[\s\S]*?Not\s*Applicable\s*[\d.]+%\s*([\d,]+\.\d{2})/);
  if (taxMatch) tax_amount = parseFloat(taxMatch[1].replace(/,/g, ''));

  // Period description (e.g. "05-03-2026 to 15-04-2026")
  const periodMatch = normalized.match(/(\d{2}-\d{2}-\d{4})\s*to\s*(\d{2}-\d{2}-\d{4})/);
  const period_description = periodMatch ? `${periodMatch[1]} to ${periodMatch[2]}` : null;

  if (!supplier_name) throw new Error('Could not extract supplier name. Is this a Shopee E-Invoice?');

  return { supplier_name, invoice_date, tax_amount, net_payable, period_description };
}

async function extractMultiplePayouts(filePaths) {
  const results = [];
  for (const filePath of filePaths) {
    try {
      const data = await extractPayoutFromFile(filePath);
      results.push({ ...data, file: path.basename(filePath), error: null });
    } catch (err) {
      results.push({ supplier_name: null, net_payable: 0, tax_amount: 0, file: path.basename(filePath), error: err.message });
    }
  }
  return results;
}

module.exports = { extractPayoutFromFile, extractMultiplePayouts };

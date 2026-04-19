const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

/**
 * Extract payout data from Shopee Self-Billed E-Invoice PDF.
 * No AI needed — pure text parsing.
 * Returns: { supplier_name, invoice_number, invoice_date, tax_amount, net_payable, period_description }
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

  // Invoice Number
  const invoiceMatch = normalized.match(/Invoice\s*No\.?\s*\/\s*Code\s*([A-Z0-9]+)/);
  const invoice_number = invoiceMatch ? invoiceMatch[1] : null;

  // Period description (e.g. "05-03-2026 to 15-04-2026")
  const periodMatch = normalized.match(/(\d{2}-\d{2}-\d{4})\s*to\s*(\d{2}-\d{2}-\d{4})/);
  const period_description = periodMatch ? `${periodMatch[1]} to ${periodMatch[2]}` : null;

  if (!supplier_name) throw new Error('Could not extract supplier name. Is this a Shopee E-Invoice?');

  return { supplier_name, invoice_number, invoice_date, tax_amount, net_payable, period_description };
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


/**
 * Extract bank account details from a bank statement PDF.
 * Returns: { account_holder, bank_name, account_number }
 */
async function extractBankStatement(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') throw new Error('Only PDF files supported.');

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text = data.text;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, ' ').replace(/\s+/g, ' ');

  // Bank name detection
  const bankPatterns = [
    { regex: /Maybank|Malayan\s*Banking/i, name: 'Maybank' },
    { regex: /CIMB\s*Bank/i, name: 'CIMB Bank' },
    { regex: /Public\s*Bank/i, name: 'Public Bank' },
    { regex: /RHB\s*Bank/i, name: 'RHB Bank' },
    { regex: /Hong\s*Leong\s*Bank/i, name: 'Hong Leong Bank' },
    { regex: /AmBank/i, name: 'AmBank' },
    { regex: /Bank\s*Islam/i, name: 'Bank Islam' },
    { regex: /Bank\s*Rakyat/i, name: 'Bank Rakyat' },
    { regex: /OCBC\s*Bank/i, name: 'OCBC Bank' },
    { regex: /HSBC/i, name: 'HSBC' },
    { regex: /Standard\s*Chartered/i, name: 'Standard Chartered' },
    { regex: /UOB/i, name: 'UOB' },
    { regex: /Alliance\s*Bank/i, name: 'Alliance Bank' },
    { regex: /Affin\s*Bank/i, name: 'Affin Bank' },
    { regex: /BSN|Bank\s*Simpanan\s*Nasional/i, name: 'BSN' },
    { regex: /Agrobank/i, name: 'Agrobank' },
  ];
  let bank_name = null;
  for (const bp of bankPatterns) {
    if (bp.regex.test(normalized)) { bank_name = bp.name; break; }
  }

  // Account number — look for common patterns (8-16 digit numbers)
  let account_number = null;
  const acctPatterns = [
    /Account\s*(?:No|Number|#)[.:]*\s*([\d\s-]{8,20})/i,
    /A\/C\s*(?:No|Number)?[.:]*\s*([\d\s-]{8,20})/i,
    /Nombor\s*Akaun[.:]*\s*([\d\s-]{8,20})/i,
  ];
  for (const pat of acctPatterns) {
    const m = normalized.match(pat);
    if (m) { account_number = m[1].replace(/[\s-]/g, '').trim(); break; }
  }

  // Account holder name
  let account_holder = null;
  const namePatterns = [
    /(?:Account\s*(?:Holder|Name)|Name)[.:]*\s*([A-Z][A-Z\s.'\/@()-]{2,50}?)(?=\s*(?:Account|A\/C|Address|IC|NRIC|Statement|Date|Period|\d))/i,
    /(?:Nama\s*(?:Pemegang|Akaun))[.:]*\s*([A-Z][A-Z\s.'\/@()-]{2,50}?)(?=\s*(?:Akaun|Alamat|No|Nombor|\d))/i,
  ];
  for (const pat of namePatterns) {
    const m = normalized.match(pat);
    if (m) { account_holder = m[1].trim(); break; }
  }

  // Fallback: if no specific name found, try lines approach
  if (!account_holder) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i];
      // Likely a name: all caps, 2+ words, no numbers
      if (/^[A-Z][A-Z\s.'\/@()-]{5,}$/.test(line) && line.split(/\s+/).length >= 2 && !/\d/.test(line)) {
        // Skip if it's a bank name
        if (!bankPatterns.some(bp => bp.regex.test(line))) {
          account_holder = line;
          break;
        }
      }
    }
  }

  return { account_holder, bank_name, account_number, raw_text: text.substring(0, 500) };
}

module.exports = { extractPayoutFromFile, extractMultiplePayouts, extractBankStatement };

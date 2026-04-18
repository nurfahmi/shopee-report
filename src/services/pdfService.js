const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

const PDF_DIR = path.join(__dirname, '../../public/generated-pdfs');
fs.mkdirSync(PDF_DIR, { recursive: true });

async function renderPDF(templateName, data, filename) {
  const templatePath = path.join(__dirname, '../views/pdf', `${templateName}.ejs`);
  const html = await ejs.renderFile(templatePath, data, { async: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const outputPath = path.join(PDF_DIR, filename);
  await page.pdf({
    path: outputPath,
    format: 'A4',
    margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    printBackground: true
  });

  await browser.close();
  return outputPath;
}

module.exports = { renderPDF };

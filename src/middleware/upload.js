const multer = require('multer');
const path = require('path');
const fs = require('fs');

function makeStorage(subfolder) {
  const dir = path.join(__dirname, '../../public/uploads', subfolder);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    }
  });
}

function fileFilter(allowedMimes) {
  return (_req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  };
}

const shopeeInvoiceUpload = multer({
  storage: makeStorage('shopee-invoices'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: fileFilter(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
});

const transferProofUpload = multer({
  storage: makeStorage('transfer-proofs'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
});

const logoUpload = multer({
  storage: makeStorage('logos'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'])
});

const mdUpload = multer({
  storage: makeStorage('md-scopes'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: fileFilter(['text/plain', 'text/markdown', 'application/octet-stream'])
});

module.exports = { shopeeInvoiceUpload, transferProofUpload, logoUpload, mdUpload };

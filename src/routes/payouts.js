const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { requireAuth, requireStudioOrUp } = require('../middleware/auth');
const { shopeeInvoiceUpload, transferProofUpload, paymentProofUpload } = require('../middleware/upload');
const multer = require('multer');

router.use(requireAuth, requireStudioOrUp);

// Converter (before /:id)
router.get('/tools/converter', payoutController.getConverter);

// Main list
router.get('/', payoutController.index);

// Upload invoices
router.post('/upload', shopeeInvoiceUpload.array('shopee_invoices', 50), payoutController.postUpload);

// Manual add
router.post('/add', payoutController.postManualEntry);

// Status update (with optional proof upload)
// We use a combined middleware that tries to parse a single file field 'proof'
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const fs = require('fs');
      const path = require('path');
      // Determine folder based on status in body — default to transfer-proofs
      const dir = path.join(__dirname, '../../public/uploads/proofs');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, unique + require('path').extname(file.originalname));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

router.post('/:id/status', proofUpload.single('proof'), payoutController.postUpdateStatus);
router.post('/:id/delete', payoutController.postDelete);

// Detail
router.get('/:id', payoutController.getDetail);

module.exports = router;

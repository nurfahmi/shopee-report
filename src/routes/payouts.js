const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { requireAuth, requireStudioOrUp, requireAnyAdmin } = require('../middleware/auth');
const { shopeeInvoiceUpload } = require('../middleware/upload');
const multer = require('multer');

router.use(requireAuth, requireStudioOrUp);

// Proof upload middleware (shared)
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const fs = require('fs');
      const path = require('path');
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

// Converter (before /:id)
router.get('/tools/converter', payoutController.getConverter);

// Main list
router.get('/', payoutController.index);

// Upload invoices
router.post('/upload', shopeeInvoiceUpload.array('shopee_invoices', 50), payoutController.postUpload);

// Manual add
router.post('/add', payoutController.postManualEntry);

// Bulk transfer (MY admin)
router.get('/transfer', payoutController.getTransfer);
router.post('/transfer', proofUpload.single('proof'), payoutController.postBulkTransfer);

// Bulk row actions on the main payouts page (no proof required)
router.post('/bulk-collect', payoutController.postBulkCollect);
router.post('/bulk-collect-bank', payoutController.postCollectBank);
router.post('/bulk-collect-period', payoutController.postCollectPeriod);
router.post('/bulk-transfer-period', payoutController.postTransferPeriod);
router.post('/bulk-receive', payoutController.postBulkReceive);
router.post('/bulk-receive-period', payoutController.postReceivePeriod);
router.post('/bulk-confirm', payoutController.postBulkConfirm);

// Studio Payments (ID admin + SA)
router.get('/studio-payments', payoutController.getStudioPayments);
router.post('/studio-payments/period/distribute', payoutController.postDistributePeriod);
router.post('/studio-payments/:studioId/distribute',
            proofUpload.single('proof'), payoutController.postDistributeStudio);

// Period report PDF (SA + MY admin) — must come before /:id
router.get('/report/:periodId', payoutController.getPeriodReport);

// Excel export (MY admin / ID admin / SA) — per-period or all periods
router.get('/export/excel', requireAnyAdmin, payoutController.getExportExcel);

// Status update
router.post('/:id/status', proofUpload.single('proof'), payoutController.postUpdateStatus);
router.post('/:id/delete', payoutController.postDelete);

// Detail
router.get('/:id', payoutController.getDetail);

module.exports = router;

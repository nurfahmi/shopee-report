const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { requireAuth, requireAnyAdmin } = require('../middleware/auth');
const { shopeeInvoiceUpload } = require('../middleware/upload');

router.use(requireAuth, requireAnyAdmin);

// Converter (before /:id)
router.get('/tools/converter', payoutController.getConverter);

// Main list
router.get('/', payoutController.index);

// Upload invoices (OCR extract + auto-link)
router.post('/upload', shopeeInvoiceUpload.array('shopee_invoices', 50), payoutController.postUpload);

// Manual add
router.post('/add', payoutController.postManualEntry);

// Entry actions
router.post('/:id/collect', payoutController.postMarkCollected);
router.post('/:id/delete', payoutController.postDelete);

// Detail (must be after /tools/ and specific POST routes)
router.get('/:id', payoutController.getDetail);

module.exports = router;

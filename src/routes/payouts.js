const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { requireAuth, requireStudioOrUp } = require('../middleware/auth');
const { shopeeInvoiceUpload } = require('../middleware/upload');

router.use(requireAuth, requireStudioOrUp);

// Converter (before /:id)
router.get('/tools/converter', payoutController.getConverter);

// Main list
router.get('/', payoutController.index);

// Upload invoices
router.post('/upload', shopeeInvoiceUpload.array('shopee_invoices', 50), payoutController.postUpload);

// Manual add
router.post('/add', payoutController.postManualEntry);

// Entry actions
router.post('/:id/status', payoutController.postUpdateStatus);
router.post('/:id/delete', payoutController.postDelete);

// Detail
router.get('/:id', payoutController.getDetail);

module.exports = router;

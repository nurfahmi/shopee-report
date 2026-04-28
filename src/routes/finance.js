const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

// Finance is ID admin + superadmin only.
router.use(requireAuth, requireISHAdmin);

// Studio picker landing
router.get('/', financeController.index);

// ── Per-studio routes (scoped under :studioId) ──
// Note: month route uses regex constraints so it doesn't shadow /staff or /period.
router.get('/:studioId(\\d+)',                                                  financeController.getStudio);
router.get('/:studioId(\\d+)/staff',                                            financeController.getStaff);
router.post('/:studioId(\\d+)/staff',                                           financeController.postStaffCreate);
router.post('/:studioId(\\d+)/staff/:id(\\d+)',                                 financeController.postStaffUpdate);
router.post('/:studioId(\\d+)/staff/:id(\\d+)/delete',                          financeController.postStaffDelete);
router.post('/:studioId(\\d+)/period/create',                                   financeController.postPeriodCreate);
router.get('/:studioId(\\d+)/:year(\\d{4})/:month(\\d{2})',                     financeController.getPeriod);
router.post('/:studioId(\\d+)/:year(\\d{4})/:month(\\d{2})/payout',             financeController.postPayoutUpsert);
router.post('/:studioId(\\d+)/:year(\\d{4})/:month(\\d{2})/expense',            financeController.postExpenseCreate);
router.post('/:studioId(\\d+)/:year(\\d{4})/:month(\\d{2})/expense/:id(\\d+)/delete', financeController.postExpenseDelete);

module.exports = router;

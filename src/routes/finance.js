const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

// Finance is ID admin + superadmin only.
router.use(requireAuth, requireISHAdmin);

// Landing page (list of monthly reports + KPIs)
router.get('/', financeController.index);

// Staff management
router.get('/staff',                financeController.getStaff);
router.post('/staff',               financeController.postStaffCreate);
router.post('/staff/:id',           financeController.postStaffUpdate);
router.post('/staff/:id/delete',    financeController.postStaffDelete);

// Create / open a monthly report
router.post('/period/create',       financeController.postPeriodCreate);

// Monthly report — ":year/:month" matches paths like /finance/2026/04
router.get('/:year(\\d{4})/:month(\\d{2})',                       financeController.getPeriod);
router.post('/:year(\\d{4})/:month(\\d{2})/payout',               financeController.postPayoutUpsert);
router.post('/:year(\\d{4})/:month(\\d{2})/expense',              financeController.postExpenseCreate);
router.post('/:year(\\d{4})/:month(\\d{2})/expense/:id/delete',   financeController.postExpenseDelete);

module.exports = router;

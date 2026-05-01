const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

// Finance is ID admin + superadmin only.
router.use(requireAuth, requireISHAdmin);

// Studio picker landing
router.get('/', financeController.index);

// ── Per-studio routes (scoped under :studioId) ──
// More-specific literal paths are declared BEFORE the generic month route so
// Express picks them first. Param validation (parseInt + range checks) happens
// inside the controllers — we don't rely on inline regex constraints because
// path-to-regexp v8+ (Express 5) dropped support for them.
router.get('/:studioId/staff',                                          financeController.getStaff);
router.post('/:studioId/staff',                                         financeController.postStaffCreate);
router.post('/:studioId/staff/:id',                                     financeController.postStaffUpdate);
router.post('/:studioId/staff/:id/delete',                              financeController.postStaffDelete);
router.post('/:studioId/period/create',                                 financeController.postPeriodCreate);
router.post('/:studioId/:year/:month/payout',                           financeController.postPayoutUpsert);
router.post('/:studioId/:year/:month/expense',                          financeController.postExpenseCreate);
router.post('/:studioId/:year/:month/expense/:id/delete',               financeController.postExpenseDelete);
router.post('/:studioId/:year/:month/income',                           financeController.postOtherIncomeCreate);
router.post('/:studioId/:year/:month/income/:id/delete',                financeController.postOtherIncomeDelete);
router.get('/:studioId/:year/:month/payslip/:staffId',                  financeController.getPayslip);
router.get('/:studioId/:year/:month',                                   financeController.getPeriod);
router.get('/:studioId',                                                financeController.getStudio);

module.exports = router;

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/logout', authController.logout);

// First-time setup
router.get('/setup', authController.getSetup);
router.post('/setup', authController.postSetup);

// Impersonate (superadmin only)
router.get('/impersonate/:id', requireAuth, requireSuperAdmin, authController.impersonate);
router.get('/stop-impersonate', requireAuth, authController.stopImpersonate);

// Change password (all authenticated users)
router.get('/change-password', requireAuth, authController.getChangePassword);
router.post('/change-password', requireAuth, authController.postChangePassword);

module.exports = router;

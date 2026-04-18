const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

router.use(requireAuth, requireSuperAdmin);

router.get('/', settingsController.index);
router.post('/', settingsController.postSave);

module.exports = router;

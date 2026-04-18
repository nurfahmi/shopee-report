const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

router.use(requireAuth, requireISHAdmin);

router.get('/', settingsController.index);
router.post('/', settingsController.postSave);

module.exports = router;

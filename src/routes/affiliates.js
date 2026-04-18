const express = require('express');
const router = express.Router();
const affiliateController = require('../controllers/affiliateController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', affiliateController.index);
router.get('/create', requireISHAdmin, affiliateController.getCreate);
router.post('/create', requireISHAdmin, affiliateController.postCreate);
router.get('/:id/edit', requireISHAdmin, affiliateController.getEdit);
router.post('/:id/edit', requireISHAdmin, affiliateController.postEdit);
router.post('/:id/delete', requireISHAdmin, affiliateController.postDelete);

module.exports = router;

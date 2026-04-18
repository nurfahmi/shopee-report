const express = require('express');
const router = express.Router();
const affiliateController = require('../controllers/affiliateController');
const { requireAuth, requireStudioOrUp, requireISHAdmin } = require('../middleware/auth');

router.use(requireAuth, requireStudioOrUp);

// View (all roles)
router.get('/', affiliateController.index);

// Edit/Create/Delete (ISH admin only = superadmin + indonesia_admin)
router.get('/create', requireISHAdmin, affiliateController.getCreate);
router.post('/create', requireISHAdmin, affiliateController.postCreate);
router.get('/:id/edit', requireISHAdmin, affiliateController.getEdit);
router.post('/:id/edit', requireISHAdmin, affiliateController.postEdit);
router.post('/:id/delete', requireISHAdmin, affiliateController.postDelete);

module.exports = router;

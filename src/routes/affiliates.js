const express = require('express');
const router = express.Router();
const affiliateController = require('../controllers/affiliateController');
const { requireAuth, requireStudioOrUp } = require('../middleware/auth');

router.use(requireAuth, requireStudioOrUp);

router.get('/', affiliateController.index);
router.get('/create', affiliateController.getCreate);
router.post('/create', affiliateController.postCreate);
router.get('/:id/edit', affiliateController.getEdit);
router.post('/:id/edit', affiliateController.postEdit);
router.post('/:id/delete', affiliateController.postDelete);

module.exports = router;

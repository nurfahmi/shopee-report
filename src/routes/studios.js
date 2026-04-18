const express = require('express');
const router = express.Router();
const studioController = require('../controllers/studioController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

router.use(requireAuth, requireISHAdmin);

router.get('/', studioController.index);
router.get('/create', studioController.getCreate);
router.post('/create', studioController.postCreate);
router.get('/:id/edit', studioController.getEdit);
router.post('/:id/edit', studioController.postEdit);
router.post('/:id/delete', studioController.postDelete);

module.exports = router;

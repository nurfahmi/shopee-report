const express = require('express');
const router = express.Router();
const bpController = require('../controllers/businessProfileController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');
const { logoUpload } = require('../middleware/upload');

router.use(requireAuth, requireISHAdmin);

router.get('/', bpController.index);
router.get('/create', bpController.getCreate);
router.post('/create', logoUpload.single('logo'), bpController.postCreate);
router.get('/:id/edit', bpController.getEdit);
router.post('/:id/edit', logoUpload.single('logo'), bpController.postEdit);
router.post('/:id/delete', bpController.postDelete);

module.exports = router;

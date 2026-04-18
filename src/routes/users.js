const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');

router.use(requireAuth, requireISHAdmin);

router.get('/', userController.index);
router.get('/create', userController.getCreate);
router.post('/create', userController.postCreate);
router.get('/:id/edit', userController.getEdit);
router.post('/:id/edit', userController.postEdit);
router.post('/:id/delete', userController.postDelete);

module.exports = router;

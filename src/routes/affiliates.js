const express = require('express');
const router = express.Router();
const affiliateController = require('../controllers/affiliateController');
const { requireAuth, requireStudioOrUp, requireISHAdmin } = require('../middleware/auth');
const multer = require('multer');

const bankUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(__dirname, '../../public/uploads/bank-statements');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, unique + require('path').extname(file.originalname));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'), false);
  }
});

router.use(requireAuth, requireStudioOrUp);

// View (all roles)
router.get('/', affiliateController.index);

// Upload bank statement OCR
router.post('/upload-statement', requireISHAdmin, bankUpload.single('bank_statement'), affiliateController.postUploadStatement);

// Edit/Create/Delete (ISH admin only = superadmin + indonesia_admin)
router.get('/create', requireISHAdmin, affiliateController.getCreate);
router.post('/create', requireISHAdmin, affiliateController.postCreate);
router.get('/:id/edit', requireISHAdmin, affiliateController.getEdit);
router.post('/:id/edit', requireISHAdmin, affiliateController.postEdit);
router.post('/:id/delete', requireISHAdmin, affiliateController.postDelete);

module.exports = router;

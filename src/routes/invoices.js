const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { requireAuth, requireISHAdmin } = require('../middleware/auth');
const { mdUpload } = require('../middleware/upload');

router.use(requireAuth, requireISHAdmin);

// Clients
router.get('/clients', invoiceController.clientsIndex);
router.get('/clients/create', invoiceController.getClientCreate);
router.post('/clients/create', invoiceController.postClientCreate);
router.get('/clients/:id/edit', invoiceController.getClientEdit);
router.post('/clients/:id/edit', invoiceController.postClientEdit);
router.post('/clients/:id/delete', invoiceController.postClientDelete);

// Projects
router.get('/projects', invoiceController.projectsIndex);
router.get('/projects/create', invoiceController.getProjectCreate);
router.post('/projects/create', mdUpload.single('scope_md'), invoiceController.postProjectCreate);
router.get('/projects/:id/edit', invoiceController.getProjectEdit);
router.post('/projects/:id/edit', mdUpload.single('scope_md'), invoiceController.postProjectEdit);
router.post('/projects/:id/delete', invoiceController.postProjectDelete);

// Invoices
router.get('/', invoiceController.index);
router.get('/create', invoiceController.getCreate);
router.post('/parse-md', mdUpload.single('md_file'), invoiceController.postParseMD);
router.post('/create', invoiceController.postCreate);
router.get('/:id', invoiceController.getDetail);
router.get('/:id/edit', invoiceController.getEdit);
router.post('/:id/edit', invoiceController.postEdit);
router.post('/:id/mark-sent', invoiceController.postMarkSent);
router.post('/:id/payment', invoiceController.postRecordPayment);
router.get('/:id/pdf', invoiceController.getPDF);
router.post('/:id/delete', invoiceController.postDelete);

module.exports = router;

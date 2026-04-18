const Client = require('../models/Client');
const Project = require('../models/Project');
const Invoice = require('../models/Invoice');
const { InvoiceItem, InvoiceMilestone, Payment } = require('../models/InvoiceRelated');
const BusinessProfile = require('../models/BusinessProfile');
const Setting = require('../models/Setting');
const { renderPDF } = require('../services/pdfService');
const { parseMD } = require('../services/mdParserService');
const { mdUpload } = require('../middleware/upload');
const fs = require('fs');
const path = require('path');

const invoiceController = {
  // ── Invoice list ─────────────────────────────────────────────────
  async index(req, res) {
    const invoices = await Invoice.findAll();
    res.render('invoices/index', { title: 'Invoices', invoices, user: req.session.user });
  },

  // ── Create form ──────────────────────────────────────────────────
  async getCreate(req, res) {
    const clients   = await Client.findAll();
    const profiles  = await BusinessProfile.findAll();
    const defaultProfileId = await Setting.get('default_business_profile_id');
    const project_id = req.query.project_id || null;
    let project = null;
    if (project_id) project = await Project.findById(project_id);
    res.render('invoices/form', {
      title: 'New Invoice', editing: false,
      invoice: {}, items: [], milestones: [],
      clients, profiles, project,
      defaultProfileId: parseInt(defaultProfileId),
      user: req.session.user
    });
  },

  // ── Parse MD (AJAX endpoint) ─────────────────────────────────────
  async postParseMD(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const content = fs.readFileSync(file.path, 'utf8');
      const parsed = parseMD(content);
      res.json({ success: true, data: parsed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  // ── Create POST ──────────────────────────────────────────────────
  async postCreate(req, res) {
    const {
      project_id, business_profile_id, issue_date, due_date,
      payment_type, tax_percent, notes,
      items_description, items_phase, items_qty, items_price, items_amount,
      milestone_label, milestone_percent, milestone_amount, milestone_due
    } = req.body;

    try {
      // Build items array
      const descriptions = [].concat(items_description || []);
      const items = descriptions.map((desc, i) => ({
        phase_label: ([].concat(items_phase || []))[i] || '',
        description: desc,
        quantity:   parseFloat(([].concat(items_qty || []))[i]) || 1,
        unit_price: parseFloat(([].concat(items_price || []))[i]) || 0,
        amount:     parseFloat(([].concat(items_amount || []))[i]) || 0
      })).filter(it => it.description);

      const subtotal   = items.reduce((s, it) => s + it.amount, 0);
      const taxPct     = parseFloat(tax_percent) || 0;
      const tax_amount = parseFloat((subtotal * taxPct / 100).toFixed(2));
      const total      = parseFloat((subtotal + tax_amount).toFixed(2));

      const { id, invoice_number } = await Invoice.create({
        project_id, business_profile_id, issue_date, due_date,
        payment_type, subtotal, tax_percent: taxPct, tax_amount, total, notes
      });

      await InvoiceItem.bulkReplace(id, items);

      // Milestones (only if milestone payment type)
      if (payment_type === 'milestone') {
        const labels    = [].concat(milestone_label || []);
        const milestones = labels.map((label, i) => ({
          label,
          percent:  parseFloat(([].concat(milestone_percent || []))[i]) || 0,
          amount:   parseFloat(([].concat(milestone_amount || []))[i]) || 0,
          due_date: ([].concat(milestone_due || []))[i] || null
        })).filter(m => m.label);
        await InvoiceMilestone.bulkReplace(id, milestones);
      }

      req.flash('success', `Invoice ${invoice_number} created.`);
      res.redirect(`/invoices/${id}`);
    } catch (err) {
      console.error(err);
      req.flash('error', err.message);
      res.redirect('/invoices/create');
    }
  },

  // ── Detail view ──────────────────────────────────────────────────
  async getDetail(req, res) {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) { req.flash('error', 'Invoice not found.'); return res.redirect('/invoices'); }
    const items      = await InvoiceItem.findByInvoice(id);
    const milestones = await InvoiceMilestone.findByInvoice(id);
    const payments   = await Payment.findByInvoice(id);
    res.render('invoices/detail', {
      title: `Invoice ${invoice.invoice_number}`,
      invoice, items, milestones, payments, user: req.session.user
    });
  },

  // ── Edit form ────────────────────────────────────────────────────
  async getEdit(req, res) {
    const { id } = req.params;
    const invoice  = await Invoice.findById(id);
    const items    = await InvoiceItem.findByInvoice(id);
    const milestones = await InvoiceMilestone.findByInvoice(id);
    const clients  = await Client.findAll();
    const profiles = await BusinessProfile.findAll();
    res.render('invoices/form', {
      title: `Edit Invoice ${invoice.invoice_number}`, editing: true,
      invoice, items, milestones, clients, profiles, project: null,
      defaultProfileId: invoice.business_profile_id,
      user: req.session.user
    });
  },

  // ── Edit POST ────────────────────────────────────────────────────
  async postEdit(req, res) {
    const { id } = req.params;
    const {
      business_profile_id, issue_date, due_date, payment_type, tax_percent, notes,
      items_description, items_phase, items_qty, items_price, items_amount,
      milestone_label, milestone_percent, milestone_amount, milestone_due
    } = req.body;

    const descriptions = [].concat(items_description || []);
    const items = descriptions.map((desc, i) => ({
      phase_label: ([].concat(items_phase || []))[i] || '',
      description: desc,
      quantity:   parseFloat(([].concat(items_qty || []))[i]) || 1,
      unit_price: parseFloat(([].concat(items_price || []))[i]) || 0,
      amount:     parseFloat(([].concat(items_amount || []))[i]) || 0
    })).filter(it => it.description);

    const subtotal   = items.reduce((s, it) => s + it.amount, 0);
    const taxPct     = parseFloat(tax_percent) || 0;
    const tax_amount = parseFloat((subtotal * taxPct / 100).toFixed(2));
    const total      = parseFloat((subtotal + tax_amount).toFixed(2));

    await Invoice.update(id, { business_profile_id, issue_date, due_date, payment_type, subtotal, tax_percent: taxPct, tax_amount, total, notes });
    await InvoiceItem.bulkReplace(id, items);

    if (payment_type === 'milestone') {
      const labels = [].concat(milestone_label || []);
      const milestones = labels.map((label, i) => ({
        label,
        percent:  parseFloat(([].concat(milestone_percent || []))[i]) || 0,
        amount:   parseFloat(([].concat(milestone_amount || []))[i]) || 0,
        due_date: ([].concat(milestone_due || []))[i] || null
      })).filter(m => m.label);
      await InvoiceMilestone.bulkReplace(id, milestones);
    }

    await Invoice.recalcBalance(id);
    req.flash('success', 'Invoice updated.');
    res.redirect(`/invoices/${id}`);
  },

  // ── Mark as sent ─────────────────────────────────────────────────
  async postMarkSent(req, res) {
    await Invoice.updateStatus(req.params.id, 'sent');
    req.flash('success', 'Invoice marked as sent.');
    res.redirect(`/invoices/${req.params.id}`);
  },

  // ── Record payment ───────────────────────────────────────────────
  async postRecordPayment(req, res) {
    const { id } = req.params;
    const { milestone_id, amount, payment_date, method, reference, notes } = req.body;
    await Payment.create({ invoice_id: id, milestone_id: milestone_id || null, amount, payment_date, method, reference, notes });
    if (milestone_id) await InvoiceMilestone.markPaid(milestone_id);
    await Invoice.recalcBalance(id);
    req.flash('success', 'Payment recorded.');
    res.redirect(`/invoices/${id}`);
  },

  // ── View / Download PDF ──────────────────────────────────────────
  async getPDF(req, res) {
    const { id } = req.params;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    const invoice  = await Invoice.findById(id);
    const items    = await InvoiceItem.findByInvoice(id);
    const milestones = await InvoiceMilestone.findByInvoice(id);
    const payments   = await Payment.findByInvoice(id);
    const filename = `${invoice.invoice_number}.pdf`;
    const outputPath = await renderPDF('invoice', { invoice, items, milestones, payments }, filename);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    fs.createReadStream(outputPath).pipe(res);
  },

  // ── Delete ───────────────────────────────────────────────────────
  async postDelete(req, res) {
    await Invoice.delete(req.params.id);
    req.flash('success', 'Invoice deleted.');
    res.redirect('/invoices');
  },

  // ── Clients ──────────────────────────────────────────────────────
  async clientsIndex(req, res) {
    const clients = await Client.findAll();
    res.render('invoices/clients/index', { title: 'Clients', clients, user: req.session.user });
  },
  getClientCreate(req, res) {
    res.render('invoices/clients/form', { title: 'Add Client', editing: false, data: {}, user: req.session.user });
  },
  async postClientCreate(req, res) {
    await Client.create(req.body);
    req.flash('success', 'Client added.');
    res.redirect('/invoices/clients');
  },
  async getClientEdit(req, res) {
    const data = await Client.findById(req.params.id);
    res.render('invoices/clients/form', { title: 'Edit Client', editing: true, data, user: req.session.user });
  },
  async postClientEdit(req, res) {
    await Client.update(req.params.id, req.body);
    req.flash('success', 'Client updated.');
    res.redirect('/invoices/clients');
  },
  async postClientDelete(req, res) {
    await Client.delete(req.params.id);
    req.flash('success', 'Client deleted.');
    res.redirect('/invoices/clients');
  },

  // ── Projects ─────────────────────────────────────────────────────
  async projectsIndex(req, res) {
    const projects = await Project.findAll();
    res.render('invoices/projects/index', { title: 'Projects', projects, user: req.session.user });
  },
  async getProjectCreate(req, res) {
    const clients = await Client.findAll();
    res.render('invoices/projects/form', { title: 'New Project', editing: false, data: {}, clients, user: req.session.user });
  },
  async postProjectCreate(req, res) {
    const file = req.file;
    const scope_md_path = file ? `/uploads/md-scopes/${file.filename}` : null;
    const id = await Project.create({ ...req.body, scope_md_path });
    req.flash('success', 'Project created.');
    res.redirect(`/invoices/create?project_id=${id}`);
  },
  async getProjectEdit(req, res) {
    const data = await Project.findById(req.params.id);
    const clients = await Client.findAll();
    res.render('invoices/projects/form', { title: 'Edit Project', editing: true, data, clients, user: req.session.user });
  },
  async postProjectEdit(req, res) {
    const file = req.file;
    const existing = await Project.findById(req.params.id);
    const scope_md_path = file ? `/uploads/md-scopes/${file.filename}` : existing.scope_md_path;
    await Project.update(req.params.id, { ...req.body, scope_md_path });
    req.flash('success', 'Project updated.');
    res.redirect('/invoices/projects');
  },
  async postProjectDelete(req, res) {
    await Project.delete(req.params.id);
    req.flash('success', 'Project deleted.');
    res.redirect('/invoices/projects');
  }
};

module.exports = invoiceController;

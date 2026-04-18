const BusinessProfile = require('../models/BusinessProfile');
const { logoUpload } = require('../middleware/upload');

const businessProfileController = {
  async index(req, res) {
    const profiles = await BusinessProfile.findAll();
    res.render('business-profiles/index', { title: 'Business Profiles', profiles, user: req.session.user });
  },

  getCreate(req, res) {
    res.render('business-profiles/form', { title: 'Add Business Profile', editing: false, data: {}, user: req.session.user });
  },

  async postCreate(req, res) {
    const file = req.file;
    const data = { ...req.body, logo_path: file ? `/uploads/logos/${file.filename}` : null, is_default: req.body.is_default === '1' };
    await BusinessProfile.create(data);
    req.flash('success', 'Business profile created.');
    res.redirect('/business-profiles');
  },

  async getEdit(req, res) {
    const data = await BusinessProfile.findById(req.params.id);
    if (!data) { req.flash('error', 'Profile not found.'); return res.redirect('/business-profiles'); }
    res.render('business-profiles/form', { title: 'Edit Business Profile', editing: true, data, user: req.session.user });
  },

  async postEdit(req, res) {
    const id = req.params.id;
    const file = req.file;
    const existing = await BusinessProfile.findById(id);
    const logo_path = file ? `/uploads/logos/${file.filename}` : existing.logo_path;
    const data = { ...req.body, logo_path, is_default: req.body.is_default === '1' };
    await BusinessProfile.update(id, data);
    req.flash('success', 'Business profile updated.');
    res.redirect('/business-profiles');
  },

  async postDelete(req, res) {
    const profile = await BusinessProfile.findById(req.params.id);
    if (profile?.is_default) {
      req.flash('error', 'Cannot delete the default profile.');
      return res.redirect('/business-profiles');
    }
    await BusinessProfile.delete(req.params.id);
    req.flash('success', 'Profile deleted.');
    res.redirect('/business-profiles');
  }
};

module.exports = businessProfileController;

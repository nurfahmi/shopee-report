const Setting = require('../models/Setting');
const BusinessProfile = require('../models/BusinessProfile');
const { logoUpload } = require('../middleware/upload');

const settingsController = {
  async index(req, res) {
    const settings = await Setting.getAll();
    const profiles = await BusinessProfile.findAll();
    res.render('settings/index', {
      title: 'Settings',
      settings,
      profiles,
      user: req.session.user
    });
  },

  async postSave(req, res) {
    const { openai_api_key, default_deduction_percent, default_business_profile_id } = req.body;
    await Setting.setMultiple({
      openai_api_key: openai_api_key || '',
      default_deduction_percent: default_deduction_percent || '5.00',
      default_business_profile_id: default_business_profile_id || '1'
    });
    req.flash('success', 'Settings saved.');
    res.redirect('/settings');
  }
};

module.exports = settingsController;

const Setting = require('../models/Setting');

const settingsController = {
  async index(req, res) {
    const settings = await Setting.getAll();
    res.render('settings/index', { title: 'Settings', settings, user: req.session.user });
  },

  async postSave(req, res) {
    const { myr_to_idr_rate, idr_to_myr_rate } = req.body;
    await Setting.setMultiple({
      myr_to_idr_rate: myr_to_idr_rate || '3600',
      idr_to_myr_rate: idr_to_myr_rate || '0.000278'
    });
    req.flash('success', 'Settings saved.');
    res.redirect('/settings');
  }
};

module.exports = settingsController;

const Setting = require('../models/Setting');

const settingsController = {
  async index(req, res) {
    const settings = await Setting.getAll();
    res.render('settings/index', { title: 'Settings', settings, user: req.session.user });
  },

  async postSave(req, res) {
    const { myr_to_idr_rate, idr_to_myr_rate,
            deduction_general_percent, deduction_my_admin_percent, deduction_id_admin_percent } = req.body;

    const updates = {
      myr_to_idr_rate: myr_to_idr_rate || '3600',
      idr_to_myr_rate: idr_to_myr_rate || '0.000278'
    };

    // Only superadmin can update deduction percentages
    if (req.session.user.role === 'superadmin') {
      updates.deduction_general_percent = deduction_general_percent || '0';
      updates.deduction_my_admin_percent = deduction_my_admin_percent || '0';
      updates.deduction_id_admin_percent = deduction_id_admin_percent || '0';
    }

    await Setting.setMultiple(updates);
    req.flash('success', 'Settings saved.');
    res.redirect('/settings');
  }
};

module.exports = settingsController;

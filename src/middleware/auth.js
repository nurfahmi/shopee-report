// Role hierarchy (lowest to highest)
const ROLES = ['studio', 'malaysia_admin', 'indonesia_admin', 'superadmin'];

function roleLevel(role) {
  return ROLES.indexOf(role);
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please login to continue.');
    return res.redirect('/auth/login');
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/auth/login');
    const effectiveRole = req.session.originalUser?.role || req.session.user.role;
    const userLevel = roleLevel(effectiveRole);
    const minRequired = Math.min(...allowedRoles.map(roleLevel));
    if (userLevel < minRequired) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: req.session.user
      });
    }
    next();
  };
}

// Shorthand guards
const requireSuperAdmin   = requireRole('superadmin');
const requireISHAdmin     = requireRole('indonesia_admin', 'superadmin');
const requireAnyAdmin     = requireRole('malaysia_admin', 'indonesia_admin', 'superadmin');
const requireStudioOrUp   = requireRole('studio', 'malaysia_admin', 'indonesia_admin', 'superadmin');

function attachLocals(req, res, next) {
  const isImpersonating = !!req.session.originalUser;
  const user = req.session.user;
  res.locals.user            = user || null;
  res.locals.originalUser    = req.session.originalUser || null;
  res.locals.isImpersonating = isImpersonating;
  res.locals.flash_success   = req.flash('success');
  res.locals.flash_error     = req.flash('error');

  res.locals.isSuperAdmin    = user?.role === 'superadmin' || isImpersonating;
  res.locals.isISHAdmin      = ['superadmin','indonesia_admin'].includes(user?.role) || isImpersonating;
  res.locals.isMYAdmin       = user?.role === 'malaysia_admin';
  res.locals.isStudio        = user?.role === 'studio';
  res.locals.studioId        = user?.studio_id || null;
  next();
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireISHAdmin, requireAnyAdmin, requireStudioOrUp, attachLocals };

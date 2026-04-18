// Role hierarchy
const ROLES = ['malaysian_admin', 'my_admin', 'superadmin'];

function roleLevel(role) {
  return ROLES.indexOf(role);
}

// Require user to be logged in
function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please login to continue.');
    return res.redirect('/auth/login');
  }
  next();
}

// Require minimum role level
// When impersonating, use the ORIGINAL user's role for permission checks
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
const requireSuperAdmin = requireRole('superadmin');
const requireISHAdmin   = requireRole('my_admin', 'superadmin');
const requireAnyAdmin   = requireRole('malaysian_admin', 'my_admin', 'superadmin');

// Attach user + helpers to res.locals so all views can access them
function attachLocals(req, res, next) {
  const isImpersonating = !!req.session.originalUser;
  res.locals.user            = req.session.user || null;
  res.locals.originalUser    = req.session.originalUser || null;
  res.locals.isImpersonating = isImpersonating;
  res.locals.flash_success   = req.flash('success');
  res.locals.flash_error     = req.flash('error');
  // During impersonation, show the IMPERSONATED user's role for UI but keep superadmin access
  res.locals.isSuperAdmin  = req.session.user?.role === 'superadmin' || isImpersonating;
  res.locals.isISHAdmin    = ['superadmin','my_admin'].includes(req.session.user?.role) || isImpersonating;
  res.locals.isMYAdmin     = req.session.user?.role === 'malaysian_admin';
  next();
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireISHAdmin, requireAnyAdmin, attachLocals };

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

  res.locals.isSuperAdmin    = user?.role === 'superadmin';
  res.locals.isISHAdmin      = ['superadmin','indonesia_admin'].includes(user?.role);
  res.locals.isMYAdmin       = user?.role === 'malaysia_admin';
  res.locals.isStudio        = user?.role === 'studio';
  res.locals.studioId        = user?.studio_id || null;
  res.locals.relativeTime    = relativeTime;
  next();
}

function relativeTime(input) {
  if (!input) return '';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(diffSec);
  const suffix = diffSec >= 0 ? 'ago' : 'from now';
  if (abs < 60)        return `just now`;
  if (abs < 3600)      return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86400)     return `${Math.round(abs / 3600)} hr ${suffix}`;
  if (abs < 86400 * 30)return `${Math.round(abs / 86400)} d ${suffix}`;
  if (abs < 86400 * 365) return `${Math.round(abs / 86400 / 30)} mo ${suffix}`;
  return `${Math.round(abs / 86400 / 365)} yr ${suffix}`;
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireISHAdmin, requireAnyAdmin, requireStudioOrUp, attachLocals };

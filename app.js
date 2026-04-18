require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const flash     = require('connect-flash');
const path      = require('path');
const fs        = require('fs');
const ejs       = require('ejs');
const db        = require('./src/config/database');
const { syncDatabase } = require('./src/config/sync');
const { attachLocals } = require('./src/middleware/auth');

const app = express();

// ── View engine ───────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ish-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

app.use(flash());
app.use(attachLocals);

// ── Setup guard: redirect to /auth/setup if no users ──────────────
app.use(async (req, res, next) => {
  // Skip for setup routes and static files
  if (req.path.startsWith('/auth/setup') || req.path.includes('.')) return next();
  try {
    const [rows] = await db.query('SELECT COUNT(*) AS c FROM users');
    if (rows[0].c === 0 && req.path !== '/auth/setup') {
      return res.redirect('/auth/setup');
    }
  } catch (err) {
    // Table might not exist yet during first sync
  }
  next();
});

// ── Layout helper middleware ──────────────────────────────────────
app.use((req, res, next) => {
  const _render = res.render.bind(res);
  res.render = function(view, opts = {}, cb) {
    if (opts.layout === false) {
      return _render(view, opts, cb);
    }
    const viewPath = path.join(app.get('views'), view + '.ejs');
    ejs.renderFile(viewPath, { ...opts, ...res.locals }, (err, body) => {
      if (err) {
        console.error('View render error:', err);
        return res.status(500).send(`<pre>${err.message}</pre>`);
      }
      _render('layouts/main', { ...opts, ...res.locals, body }, cb);
    });
  };
  next();
});

// ── Routes ────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));

app.use('/auth',              require('./src/routes/auth'));
app.use('/dashboard',         require('./src/routes/dashboard'));
app.use('/users',             require('./src/routes/users'));
app.use('/settings',          require('./src/routes/settings'));
app.use('/shopee/affiliates', require('./src/routes/affiliates'));
app.use('/shopee/payouts',    require('./src/routes/payouts'));
app.use('/studios',           require('./src/routes/studios'));

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'The page you are looking for does not exist.',
    user: req.session?.user || null
  });
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`<h1>Server Error</h1><pre>${err.message}</pre><a href="/dashboard">Go back</a>`);
});

// ── Ensure upload directories ─────────────────────────────────────
['shopee-invoices', 'transfer-proofs', 'logos', 'md-scopes'].forEach(dir => {
  fs.mkdirSync(path.join(__dirname, 'public/uploads', dir), { recursive: true });
});
fs.mkdirSync(path.join(__dirname, 'public/generated-pdfs'), { recursive: true });

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Auto-sync database (create DB + tables if not exist)
    await syncDatabase();

    // Test pool connection
    await db.query('SELECT 1');
    console.log('✓ Database pool ready');

    app.listen(PORT, () => {
      console.log(`✓ Shopee Report running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('✗ Startup failed:', err.message);
    process.exit(1);
  }
}

start();

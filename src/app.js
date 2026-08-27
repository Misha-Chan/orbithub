const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { initSchema } = require('./db/schema');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const messagesRoutes = require('./routes/messages.routes');
const groupsRoutes = require('./routes/groups.routes');
const keysRoutes = require('./routes/keys.routes');
const typingRoutes = require('./routes/typing.routes');
const settingsRoutes = require('./routes/settings.routes');
const usersRoutes = require('./routes/users.routes');
const uploadRoutes = require('./routes/upload.routes');
const reportsRoutes = require('./routes/reports.routes');
const linkPreviewRoutes = require('./routes/linkpreview.routes');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// Open Graph — Orbithub had none before. Every conversation lives
// behind login, so there's no per-content preview to build here (that
// would leak private messages) — just correct, branded static tags,
// same site_name/description/image pattern used by the other Hostaka
// Ecosystem subdomains, so a shared orbithub.hostaka.fun link at least
// shows the right name, description and logo instead of nothing.
// ============================================================
const SITE_NAME = 'Orbithub';
const DEFAULT_DESC = 'Orbithub — نظام مراسلات هوستاكا الخاص والجماعي.';
const DEFAULT_IMG = '/orbithub-icon.png';

function ogEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function absUrl(req, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  return `https://${req.get('host')}${p.startsWith('/') ? p : '/' + p}`;
}
function injectOG(html, meta) {
  const title = ogEscape(meta.title || SITE_NAME);
  const desc = ogEscape(meta.description || DEFAULT_DESC);
  const image = ogEscape(meta.image || '');
  const url = ogEscape(meta.url || '');
  let tags = `  <meta property="og:site_name" content="${SITE_NAME}">\n`;
  tags += `  <meta property="og:title" content="${title}">\n`;
  tags += `  <meta property="og:description" content="${desc}">\n`;
  tags += `  <meta property="og:image" content="${image}">\n`;
  tags += `  <meta property="og:type" content="website">\n`;
  if (url) tags += `  <meta property="og:url" content="${url}">\n`;
  tags += `  <meta name="twitter:card" content="summary_large_image">\n`;
  tags += `  <meta name="twitter:title" content="${title}">\n`;
  tags += `  <meta name="twitter:description" content="${desc}">\n`;
  tags += `  <meta name="twitter:image" content="${image}">\n`;
  tags += `  <script src="/ecosystem-switcher.js" defer></script>\n`;
  if (/<title>[\s\S]*?<\/title>/.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>\n${tags}`);
  }
  return html.replace('</head>', `${tags}</head>`);
}

/**
 * بوابة /chat على hostaka.fun تحوّل المستخدم لـ
 * https://orbithub.hostaka.fun/chat?token=... (راجع sendSubdomainRedirect
 * بمشروع hostaka-main) — يعني /chat (بدون .html) لازم يكون مسار حقيقي
 * هنا، مو بس اسم ملف. express.static وحده ما يعرف يوصّل /chat لـ
 * chat.html (هو يبحث عن ملف اسمه "chat" بالضبط، وما يلاقيه، فيرجّع 404).
 * هذا كان سبب الـ 404 اللي كان يطلع بعد التحويل من Hostaka.
 */
app.get('/chat', (req, res) => {
  const meta = {
    title: `${SITE_NAME} — Hostaka Messages`,
    description: DEFAULT_DESC,
    image: absUrl(req, DEFAULT_IMG),
    url: absUrl(req, req.originalUrl)
  };
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat.html'), 'utf-8');
    res.set('Content-Type', 'text/html; charset=utf-8').send(injectOG(html, meta));
  } catch (e) {
    res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
  }
});

// أي رابط قديم لجذر الموقع يوديه لنفس صفحة الدردشة (لا يوجد صفحة هبوط
// منفصلة بـ orbithub — هو فرع مراسلات فقط).
app.get('/', (req, res) => res.redirect('/chat'));

// ============================================================
// robots.txt / sitemap.xml — Orbithub (orbithub.hostaka.fun), part of
// the Hostaka Ecosystem. Private & group messaging system — every
// conversation lives behind login, so there is no browsable public
// content to list beyond the app shell itself. Still exposed so
// Google can discover and correctly attribute this subdomain instead
// of treating it as unindexed/unknown — same pattern used by
// hostaka.fun/sitemap.xml, kept minimal on purpose.
// ============================================================
app.get('/robots.txt', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><priority>0.8</priority></url>
</urlset>`);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/typing', typingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/link-preview', linkPreviewRoutes);

// 404 لأي مسار API غير معروف
app.use('/api', (req, res) => res.status(404).json({ error: 'مسار غير موجود' }));

app.use(errorHandler);

/**
 * تهيئة الجداول مرة واحدة فقط لكل عملية (process) — نخزّن الـ Promise ونعيد
 * استخدامه، بدل ما نشغّل initSchema() من جديد بكل طلب. هذا مهم بالذات على
 * Vercel: كل "cold start" يشغّل هذا الملف من الصفر، فلازم نتأكد أن أول طلب
 * بهيك cold start ينتظر جهوزية القاعدة قبل ما يكمل.
 */
let schemaReadyPromise = null;
function ensureSchemaReady() {
  if (!schemaReadyPromise) schemaReadyPromise = initSchema();
  return schemaReadyPromise;
}

module.exports = { app, ensureSchemaReady };

// ============================================================
//  orbithub — سيرفر مستقل يخدّم فقط صفحتي الدردشة والمجموعات
//  كل منطق المصادقة/قاعدة البيانات يبقى على السيرفر الرئيسي (hostaka.fun)؛
//  هذا السيرفر واجهة + بروكسي شفاف لـ /api/* تجاهه.
// ============================================================
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();

// النطاق الرئيسي لهوستاكا (وين تعيش فعلياً كل الـ API + قاعدة البيانات)
const HOSTAKA_API_BASE = process.env.HOSTAKA_API_BASE || 'https://hostaka.fun';

app.disable('x-powered-by');
app.set('trust proxy', true);

// ============================================================
// بروكسي /api/* — يمرر الطلب كما هو (نفس الميثود، الهيدرز، والبودي)
// للسيرفر الرئيسي، ويرجّع الرد كما هو للعميل. هذا يخلي المتصفح يشوف
// الطلب وكأنه لنفس نطاق orbithub.hostaka.fun (نفس-المصدر تماماً)، فما
// فيه أي مشكلة CORS ولا داعي لتعديل شي بالسيرفر الرئيسي لهذا السبب.
// ============================================================
app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const targetUrl = HOSTAKA_API_BASE + '/api' + req.url;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // تجاهل هيدرز خاصة بالاتصال نفسه (يُعاد بناؤها تلقائياً حسب الوجهة)
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) continue;
      headers[key] = value;
    }

    const hasBody = req.body && Buffer.isBuffer(req.body) && req.body.length > 0;
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual'
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const buf = await upstream.buffer();
    res.send(buf);
  } catch (e) {
    console.error('❌ orbithub proxy error:', e);
    res.status(502).json({ error: 'تعذر الاتصال بخادم هوستاكا الرئيسي' });
  }
});

// ============================================================
// ملفات ثابتة (chat.html/js/css، group.html/js/css، الحزم المشتركة...)
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

function sendPrivate(res, fileName) {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', fileName));
}

app.get('/',      (req, res) => res.redirect('/chat'));
app.get('/chat',  (req, res) => sendPrivate(res, 'chat.html'));
app.get('/group', (req, res) => sendPrivate(res, 'group.html'));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// أي مسار غير معروف يرجع لصفحة الدردشة (بدل 404 فاضي)
app.use((req, res) => res.redirect('/chat'));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ orbithub server running on port ${PORT} (proxying /api to ${HOSTAKA_API_BASE})`));
}

module.exports = app;

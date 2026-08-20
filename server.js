// ============================================================
//  orbithub — سيرفر مستقل يخدّم فقط صفحتي الدردشة والمجموعات
//  كل منطق المصادقة/قاعدة البيانات يبقى على السيرفر الرئيسي (hostaka.fun)؛
//  هذا السيرفر واجهة + بروكسي شفاف لـ /api/* تجاهه. لا قاعدة بيانات ولا
//  متغيرات بيئة خاصة به عدا HOSTAKA_API_BASE (نفسها القديمة تماماً).
//
//  إعادة البناء هاي ركّزت على نفس العقد الوظيفي بالضبط (نفس المسارات،
//  نفس السلوك تجاه العميل) بس بمعالجة أخطاء أوضح وصريحة بدل الفشل
//  الصامت، عشان أي عطل مستقبلي (بالسيرفر الرئيسي أو الشبكة بينهم)
//  يظهر برسالة/سجل واضح فوراً بدل ما يختفي كصفحة فاضية أو سلوك غامض.
// ============================================================
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();

// النطاق الرئيسي لهوستاكا (وين تعيش فعلياً كل الـ API + قاعدة البيانات)
const HOSTAKA_API_BASE = (process.env.HOSTAKA_API_BASE || 'https://hostaka.fun').replace(/\/+$/, '');
const PROXY_TIMEOUT_MS = 20000; // لا تعلّق الطلب للأبد لو السيرفر الرئيسي متعطّل

app.disable('x-powered-by');
app.set('trust proxy', true);

// ============================================================
// فحص صحة بسيط — يفيد لتشخيص "هل هذا السيرفر أصلاً وصلت له آخر نسخة؟"
// بسرعة عبر GET /healthz بدون الحاجة تفتح الدردشة أو تفحص Network tab.
// يرجّع أيضاً هل استطاع الوصول لسيرفر هوستاكا الرئيسي أم لا.
// ============================================================
app.get('/healthz', async (req, res) => {
  const result = { ok: true, hostakaApiBase: HOSTAKA_API_BASE, upstream: 'unknown' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(HOSTAKA_API_BASE + '/api/health', { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    result.upstream = r ? `reachable (status ${r.status})` : 'unreachable';
  } catch (e) {
    result.upstream = 'unreachable';
  }
  res.json(result);
});

// ============================================================
// بروكسي /api/* — يمرر الطلب كما هو (نفس الميثود، الهيدرز، والبودي)
// للسيرفر الرئيسي، ويرجّع الرد كما هو للعميل. هذا يخلي المتصفح يشوف
// الطلب وكأنه لنفس نطاق orbithub.hostaka.fun (نفس-المصدر تماماً)، فما
// فيه أي مشكلة CORS ولا داعي لتعديل شي بالسيرفر الرئيسي لهذا السبب.
//
// ملاحظات مهمة عن التصرف عند الأعطال (كانت غائبة بالنسخة السابقة):
//  - لو السيرفر الرئيسي ما ردّ خلال PROXY_TIMEOUT_MS، نرجّع 504 صريح
//    بدل ما يعلّق الطلب للأبد على المتصفح.
//  - أي استثناء بالبروكسي نفسه يترجّع كـ JSON واضح {error, detail}
//    بدل ما يطيح السيرفر كامل أو يرجّع صفحة HTML افتراضية مبهمة.
// ============================================================
app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const targetUrl = HOSTAKA_API_BASE + '/api' + req.url;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);

  try {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // تجاهل هيدرز خاصة بالاتصال نفسه (يُعاد بناؤها تلقائياً حسب الوجهة)
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) continue;
      headers[key] = value;
    }

    const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      signal: ctrl.signal,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const buf = await upstream.buffer();
    res.send(buf);
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error(`❌ orbithub proxy timeout (${PROXY_TIMEOUT_MS}ms) → ${targetUrl}`);
      res.status(504).json({ error: 'انتهت مهلة الاتصال بخادم هوستاكا الرئيسي', target: targetUrl });
    } else {
      console.error('❌ orbithub proxy error:', targetUrl, e);
      res.status(502).json({ error: 'تعذر الاتصال بخادم هوستاكا الرئيسي', detail: e.message });
    }
  } finally {
    clearTimeout(timeout);
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

// أي مسار غير معروف (وليس تحت /api) يرجع لصفحة الدردشة بدل 404 فاضي
app.use((req, res) => res.redirect('/chat'));

// شبكة أمان أخيرة: أي استثناء غير متوقع بأي مسار ما زال يرجّع JSON
// واضح بدل ما يسقط الاتصال بصمت أو يرجّع صفحة خطأ افتراضية مبهمة.
app.use((err, req, res, next) => {
  console.error('❌ orbithub unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'خطأ غير متوقع بالسيرفر' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ orbithub server running on port ${PORT} (proxying /api to ${HOSTAKA_API_BASE})`);
  });
}

module.exports = app;

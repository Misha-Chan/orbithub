// ============================================================
// linkpreview.routes.js — fetches Open Graph metadata (title,
// description, image, site name) for a URL a user pasted into a chat
// message, so the chat UI can render a rich preview card instead of a
// plain-text link. This is what was missing: Orbithub could receive
// links, but never unfurled them like a normal messenger does.
//
// Runs server-side (not client-side fetch) mainly to avoid CORS issues
// — most sites don't send Access-Control-Allow-Origin, so the browser
// can't read the target page's HTML directly. Requires login (same as
// every other /api route here) so this can't be used as an open
// URL-fetching proxy by random callers.
//
// ===== حماية SSRF =====
// لأن الخادم يجلب رابطاً يختاره المستخدم، لازم نمنع استهداف الشبكة
// الداخلية (127.0.0.1، 169.254.169.254 لبيانات الـ metadata السحابية،
// 10.x، 192.168.x، fc00::/7، إلخ). نتحقق من كل عناوين الـ DNS التي
// يُحلّ إليها النطاق قبل الجلب، ونتابع التحويلات يدوياً (بدل ما نترك
// fetch يتابعها تلقائياً) مع إعادة التحقق من كل قفزة — وإلا موقع عام
// يقدر يعمل redirect لعنوان داخلي ويتجاوز الفحص.
//
// ملاحظة صادقة: يبقى احتمال نظري ضئيل لـ DNS rebinding (تغيّر نتيجة
// الـ DNS بين فحصنا وجلب fetch الفعلي) — إغلاقه كاملاً يحتاج تثبيت الـ IP
// على الاتصال، وهو غير ممكن بسهولة مع TLS/SNI. الفحص + متابعة التحويلات
// اليدوية يغلق المسار العملي الشائع (العناوين الداخلية المباشرة والـ
// open-redirect).
// ============================================================
const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ذاكرة تخزين مؤقت بسيطة داخل العملية (مو قاعدة بيانات) — كل رابط
// يُجلَب مرة كل ساعة كحد أقصى، بدل ما نطلب نفس الرابط من جديد كل
// استطلاع دوري (2.5 ثانية) من كل مستخدم يشوف نفس الرسالة.
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map();

function ogFrom(html, prop) {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? m[1] : '';
}
function titleFrom(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}
function decodeEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ===== فحص العناوين =====
function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                                 // 0.0.0.0/8
  if (a === 10) return true;                                // 10/8
  if (a === 127) return true;                               // loopback
  if (a === 169 && b === 254) return true;                  // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16/12
  if (a === 192 && b === 168) return true;                  // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;        // CGNAT 100.64/10
  if (a === 192 && b === 0 && p[2] === 0) return true;      // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;     // 198.18/15
  if (a >= 224) return true;                                // multicast + reserved
  return false;
}

function isPrivateIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isPrivateIPv4(ip);
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80')) return true;              // link-local fe80::/10
    if (/^f[cd]/.test(lower)) return true;                   // ULA fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
  }
  return true; // ليس IP صالحاً → نرفض
}

/** يتحقق أن الرابط http(s) عام، ويحلّ النطاق ويمنع أي عنوان داخلي */
async function assertPublicUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new ApiError(400, 'رابط غير صالح'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ApiError(400, 'رابط غير صالح');
  if (url.username || url.password) throw new ApiError(400, 'رابط غير صالح');

  const host = url.hostname;
  // لو المستخدم أعطى IP مباشرة، افحصه فوراً
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new ApiError(400, 'عنوان غير مسموح');
    return url;
  }
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host)) {
    throw new ApiError(400, 'عنوان غير مسموح');
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new ApiError(400, 'تعذر تحليل اسم النطاق');
  }
  if (!addresses.length) throw new ApiError(400, 'تعذر تحليل اسم النطاق');
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw new ApiError(400, 'عنوان غير مسموح');
  }
  return url;
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OrbithubLinkPreview/1.0; +https://orbithub.hostaka.fun)',
};

/** يجلب الرابط مع متابعة تحويلات محدودة يدوياً (يعيد التحقق من كل قفزة) */
async function fetchSafe(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let r;
    try {
      r = await fetch(current, { signal: controller.signal, redirect: 'manual', headers: FETCH_HEADERS });
    } finally {
      clearTimeout(timer);
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    return r;
  }
  return null; // تحويلات كثيرة جداً
}

router.get('/', asyncHandler(async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, 'رابط غير صالح');

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return res.json(cached.data);

  let data = { url, title: '', description: '', image: '', siteName: '' };
  try {
    const r = await fetchSafe(url);
    if (r && r.ok) {
      // ما نقرا الصفحة كلها لو ضخمة — أول 200 كيلوبايت كافية لوسوم <head>
      const reader = r.body.getReader();
      let received = 0, chunks = [];
      const LIMIT = 200 * 1024;
      while (received < LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
      }
      try { reader.cancel(); } catch (e) { /* تجاهل */ }
      const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');

      data.title = decodeEntities(ogFrom(html, 'og:title') || titleFrom(html));
      data.description = decodeEntities(ogFrom(html, 'og:description'));
      data.image = ogFrom(html, 'og:image');
      data.siteName = decodeEntities(ogFrom(html, 'og:site_name') || new URL(url).hostname);
      if (data.image && !/^https?:\/\//i.test(data.image)) {
        data.image = new URL(data.image, url).toString();
      }
    }
  } catch (e) {
    // فشل الجلب (موقع بطيء/رافض/غير موجود/عنوان محجوب) — نرجّع بيانات
    // فاضية، الواجهة ببساطة ما تعرض بطاقة معاينة بدل ما تكسر عرض الرسالة
  }

  // حدّ لحجم الكاش (يمنع تسريب الذاكرة بعملية طويلة العمر)
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(url, { at: Date.now(), data });
  res.json(data);
}));

module.exports = router;

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
// ============================================================
const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ذاكرة تخزين مؤقت بسيطة داخل العملية (مو قاعدة بيانات) — كل رابط
// يُجلَب مرة كل ساعة كحد أقصى، بدل ما نطلب نفس الرابط من جديد كل
// استطلاع دوري (2.5 ثانية) من كل مستخدم يشوف نفس الرسالة.
const CACHE_TTL_MS = 60 * 60 * 1000;
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

router.get('/', asyncHandler(async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, 'رابط غير صالح');

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return res.json(cached.data);

  let data = { url, title: '', description: '', image: '', siteName: '' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbithubLinkPreview/1.0; +https://orbithub.hostaka.fun)' },
    });
    clearTimeout(timer);
    if (r.ok) {
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
    // فشل الجلب (موقع بطيء/رافض/غير موجود) — نرجّع بيانات فاضية، الواجهة
    // ببساطة ما تعرض بطاقة معاينة بدل ما تكسر عرض الرسالة
  }

  cache.set(url, { at: Date.now(), data });
  res.json(data);
}));

module.exports = router;

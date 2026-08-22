/**
 * المصادقة هنا موحّدة مع Hostaka بالكامل — لا يوجد تسجيل دخول منفصل في
 * orbithub، ولا حتى نسخة من JWT_SECRET. بدل ما نتحقق من توقيع التوكن
 * محلياً (كان لازم يطابق JWT_SECRET بالضبط بمشروعين منفصلين — بالضبط
 * السبب اللي عمل حلقة 401 اللانهائية)، نفوّض التحقق بالكامل لـ Hostaka
 * نفسه عبر GET https://hostaka.fun/api/auth/me: مسار خفيف جداً بالفعل
 * (بدون أي استعلام قاعدة بيانات، فقط jwt.verify + رجوع {id, username,
 * role, avatar}) — Hostaka هو مصدر الحقيقة الوحيد لصلاحية أي جلسة، مو
 * نسخة مكرَّرة من سر موقّع بمكانين قابلة تنحرف عن بعض بصمت.
 *
 * السلبية الوحيدة: طلب شبكة إضافي لكل طلب API. نخفّفها بذاكرة تخزين
 * مؤقت صغيرة (60 ثانية لكل توكن) — كافية لتقليل الحمل الفعلي (orbithub
 * يعمل polling متكرر بالمحادثات) بدون ما تأخر اكتشاف تسجيل خروج فعلي
 * كثيراً.
 */
const HOSTAKA_ME_URL = process.env.HOSTAKA_BASE_URL
  ? `${process.env.HOSTAKA_BASE_URL}/api/auth/me`
  : 'https://hostaka.fun/api/auth/me';

const CACHE_TTL_MS = 60 * 1000;
const verifiedCache = new Map(); // token -> { user, expiresAt }

function cleanupExpired() {
  const now = Date.now();
  for (const [tok, entry] of verifiedCache) {
    if (entry.expiresAt <= now) verifiedCache.delete(tok);
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.cookies?.hostaka_token || req.cookies?.token);

  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول عبر Hostaka' });

  const cached = verifiedCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.user = cached.user;
    return next();
  }

  try {
    const r = await fetch(HOSTAKA_ME_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
    const data = await r.json();
    const user = { id: data.id, username: data.username };

    if (verifiedCache.size > 500) cleanupExpired(); // تنظيف دوري بسيط، ما نخلي الذاكرة تكبر بلا حدود
    verifiedCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });

    req.user = user;
    next();
  } catch (e) {
    console.error('❌ تعذر التحقق من الجلسة عبر Hostaka:', e.message || e);
    res.status(503).json({ error: 'تعذر التحقق من الجلسة حالياً، حاول لاحقاً' });
  }
}

module.exports = { requireAuth };

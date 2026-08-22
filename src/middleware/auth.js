const jwt = require('jsonwebtoken');

/**
 * المصادقة هنا موحّدة مع Hostaka بالكامل: لا يوجد تسجيل دخول منفصل في
 * orbithub. التوكن يصل عبر Authorization: Bearer (نفس أسلوب باقي صفحات
 * Hostaka بالضبط — script.js وغيره يرسلونه هيك دايماً)، والواجهة الأمامية
 * تجيبه من localStorage بعد ما توصلها كـ ?token= من بوابة /chat في Hostaka
 * (راجع public/shared.js هنا لتفاصيل الالتقاط، وserver.js في Hostaka
 * لدالة sendSubdomainRedirect — نفس آلية aethercast/console بالضبط).
 * كوكي hostaka_token (لو وُجدت مستقبلاً عبر oauth.hostaka.fun) مدعومة هنا
 * أيضاً كمصدر احتياطي، بس Bearer هو المسار الفعلي المستخدم حالياً.
 * يُتحقق من التوكن بنفس JWT_SECRET المستخدم في Hostaka، فأي جلسة صادرة من
 * هناك صالحة هنا تلقائياً بدون أي تسجيل حساب إضافي.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.cookies?.hostaka_token || req.cookies?.token);

  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول عبر Hostaka' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose === '2fa_pending') {
      return res.status(401).json({ error: 'يجب إكمال المصادقة الثنائية أولاً' });
    }
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
  }
}

module.exports = { requireAuth };

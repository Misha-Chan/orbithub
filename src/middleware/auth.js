const jwt = require('jsonwebtoken');

/**
 * المصادقة هنا موحّدة مع Hostaka بالكامل: لا يوجد تسجيل دخول منفصل في
 * orbithub. التوكن يوصل بإحدى طريقتين:
 *   1) كوكي hostaka_token المشتركة على نطاق .hostaka.fun (تُكتب من صفحات
 *      Hostaka نفسها عند تسجيل الدخول — راجع public/shared.js في Hostaka).
 *   2) رأس Authorization: Bearer (نفس أسلوب Hostaka، مفيد أيضاً للاختبار
 *      المحلي/بدوات خارج نطاق hostaka.fun حيث الكوكي واسعة النطاق ما تنفع).
 * كلا المصدرين يُتحقق منهما بنفس JWT_SECRET المستخدم في Hostaka، فأي جلسة
 * صادرة من Hostaka صالحة هنا تلقائياً بدون أي تسجيل حساب إضافي.
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

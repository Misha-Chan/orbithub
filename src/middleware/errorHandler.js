/**
 * معالج أخطاء مركزي واحد. كل الراوتات ترمي (throw) أخطاء ApiError أو أي Error،
 * وتوصل هون بدل ما كل راوت يكتب try/catch يدوي ويرجع رسالة عامة "خطأ بالخادم"
 * تخفي السبب الحقيقي — وهذا كان مصدر أعطال كثيرة صعب تشخيصها بالنسخة القديمة.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`❌ [${req.method} ${req.originalUrl}]`, err);
  }
  // لا نُسرّب رسائل الأخطاء الداخلية (SQL/مسارات/كود) للعميل عند 5xx.
  const body = { error: status >= 500 ? 'خطأ في الخادم' : (err.message || 'خطأ في الطلب') };
  if (err.lockedUntil) body.lockedUntil = err.lockedUntil;
  res.status(status).json(body);
}

module.exports = { errorHandler };

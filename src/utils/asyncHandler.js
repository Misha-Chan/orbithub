/**
 * يلف async route handler عشان أي استثناء يوصل تلقائياً لـ Express error handler
 * بدل ما ننسى try/catch بكل راوت (هذا كان سبب كثير أعطال "بسيطة بس ما تنحل"
 * بالنسخة القديمة — استثناء غير ملتقط كان يطيح السيرفر أو يعلّق الطلب).
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };

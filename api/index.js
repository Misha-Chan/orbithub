const { app, ensureSchemaReady } = require('../src/app');

/**
 * على Vercel كل استدعاء ممكن يوصل لعملية (process) جديدة بالكامل ("cold start"،
 * أو Vercel يشغّل نسخ متوازية من الدالة تحت الحمل). عشان هيك، أي طلب لازم
 * ينتظر جهوزية الجداول أولاً قبل ما يوصل لـ Express — بعكس التشغيل المحلي
 * (server.js) يلي فيه ننتظر مرة وحدة بالبداية بس لأن فيه عملية واحدة مستمرة.
 *
 * لاحظ: ensureSchemaReady() تخزّن الـ Promise وتعيد استخدامه، فهذا لا يعيد
 * تشغيل CREATE TABLE IF NOT EXISTS إلا مرة وحدة لكل عملية فعلية.
 */
module.exports = async (req, res) => {
  try {
    await ensureSchemaReady();
  } catch (err) {
    console.error('❌ Database not reachable:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'تعذر الاتصال بقاعدة البيانات — تأكد من ضبط TURSO_DATABASE_URL و TURSO_AUTH_TOKEN في إعدادات المشروع على Vercel',
    }));
    return;
  }
  app(req, res);
};

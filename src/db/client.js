const { createClient } = require('@libsql/client');

/**
 * سبب حقيقي شائع بالبيئات serverless (Vercel): لما الدالة تتوقف مؤقتًا
 * (idle) بين طلبين وترجع تشتغل، الاتصال القديم المخزّن بالـ singleton
 * ممكن يكون "ميت" فعلياً (مقطوع من طرف السيرفر البعيد) بدون ما أي طرف
 * يعرف بهذا فوراً — فأول استعلام بعدها يعلّق (hang) بدل ما يفشل بسرعة،
 * لحد ما Vercel نفسه يقطع الدالة (504) بعد مهلته (10 ثانية هنا). هذا
 * يفسّر تحديداً ليش صار حتى بـ /api/auth/me (استعلام سطر وحد بالقاعدة).
 *
 * الحل هنا طبقتين:
 *  1) مهلة زمنية يدوية (5 ثواني) على كل استعلام: لو تجاوزها، نفشل بسرعة
 *     بخطأ واضح بدل الانتظار لحد ما Vercel يقطع الاتصال بالكامل.
 *  2) عند الفشل بمهلة، نتخلّص من الاتصال العالق فورًا (global._dbClient
 *     = null) عشان الطلب التالي يفتح اتصال جديد سليم بدل ما يعيد استخدام
 *     نفس الاتصال الميت — هذا هو الجزء "الشافي لنفسه" (self-healing).
 */
const QUERY_TIMEOUT_MS = 5000;

function getClient() {
  if (!global._dbClient) {
    global._dbClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return global._dbClient;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`انتهت مهلة الاتصال بقاعدة البيانات (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** يحوّل نتيجة عدة صفوف إلى مصفوفة كائنات JS عادية */
function rows(result) {
  return result.rows.map((r) => Object.fromEntries(Object.entries(r)));
}

/** يحوّل نتيجة إلى أول صف فقط (أو null) */
function first(result) {
  const r = result.rows[0];
  return r ? Object.fromEntries(Object.entries(r)) : null;
}

/**
 * تنفيذ استعلام SQL مع باراميترات، يرجّع النتيجة الخام (result.rows / result.rowsAffected).
 * كل الاستعلامات بالمشروع لازم تمر من هنا وتستخدم "?" placeholders — ممنوع تركيب SQL بالـ string concatenation.
 */
async function run(sql, params = []) {
  try {
    return await withTimeout(getClient().execute({ sql, args: params }), QUERY_TIMEOUT_MS);
  } catch (err) {
    if (String(err.message).includes('انتهت مهلة الاتصال')) {
      console.error('❌ مهلة اتصال قاعدة البيانات — يُعاد إنشاء الاتصال للطلب القادم:', sql.slice(0, 60));
      global._dbClient = null; // نتخلّص من الاتصال العالق، الطلب التالي يفتح وحدة جديدة
    }
    throw err;
  }
}

module.exports = { get db() { return getClient(); }, run, rows, first };

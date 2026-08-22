const { createClient } = require('@libsql/client');

// عميل واحد يُعاد استخدامه (singleton) بدل فتح اتصال جديد كل مرة.
if (!global._dbClient) {
  global._dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}
const db = global._dbClient;

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
  return db.execute({ sql, args: params });
}

module.exports = { db, run, rows, first };

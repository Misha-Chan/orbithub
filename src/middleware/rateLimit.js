/**
 * حدّ معدّل بسيط داخل العملية (in-memory) لكل IP على مسارات /api/*.
 *
 * ملاحظة صادقة: على Vercel الدالة serverless، العدّاد يعيش بعملية واحدة فقط،
 * فكل "cold start" أو نسخة متوازية تبدأ العدّاد من الصفر — يعني هذا حماية
 * أفضل-من-لا-شيء ضد الاجتياح الآلي/الحلقة المفرطة، مو حدّ صارم موزّع. لحدّ
 * موزّع فعلي عبر كل النسخ نحتاج تخزيناً مشتركاً (Redis/Upstash) — خارج نطاق
 * هذه الإصلاحات الآمنة. مع ذلك يمنع الحالات الواقعية الشائعة (polling جامح
 * من نفس النسخة، حلقة retry، سكربت من IP واحد).
 */
const WINDOW_MS = 60 * 1000;
const MAX = Number(process.env.RATE_LIMIT_MAX || 240);
const buckets = new Map();

function rateLimit(req, res, next) {
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  res.setHeader('X-RateLimit-Limit', MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX - bucket.count));

  if (bucket.count > MAX) {
    return res.status(429).json({ error: 'طلبات كثيرة، حاول لاحقاً' });
  }
  if (buckets.size > 10000) buckets.clear();
  next();
}

module.exports = { rateLimit };

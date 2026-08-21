const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const users = require('../services/users.service');
const keys = require('../services/keys.service');

const router = express.Router();
router.use(requireAuth);

// ملاحظة تصميم: قصداً حطينا "/backup/*" و"/public/*" كمسارات ثابتة منفصلة
// (بدل خلط /:username مع /pin-status بنفس المستوى زي المشروع القديم) —
// هذا يمنع تصنيفاً كاملاً من الأخطاء الناتجة عن تعارض ترتيب الراوتات في Express.

// ===== تبادل المفتاح العام =====
router.post('/public', asyncHandler(async (req, res) => {
  const { publicKey } = req.body || {};
  if (!publicKey || typeof publicKey !== 'string' || publicKey.length > 2000) {
    throw new ApiError(400, 'مفتاح غير صالح');
  }
  await users.setPublicKey(req.user.id, publicKey);
  res.json({ success: true });
}));

router.get('/public/:username', asyncHandler(async (req, res) => {
  const user = await users.getUserByUsername(req.params.username);
  if (!user) throw new ApiError(404, 'غير موجود');
  res.json({ publicKey: user.public_key || null });
}));

// ===== نسخة PIN الاحتياطية =====
router.get('/backup/status', asyncHandler(async (req, res) => {
  const backup = await keys.getKeyBackup(req.user.id);
  if (!backup) return res.json({ hasBackup: false });
  const locked = keys.isLocked(backup);
  res.json({
    hasBackup: true,
    locked,
    lockedUntil: locked ? backup.locked_until : null,
    attemptsRemaining: locked ? 0 : Math.max(0, keys.PIN_MAX_ATTEMPTS - (backup.failed_attempts || 0)),
    salt: backup.salt,
    iterations: backup.iterations,
  });
}));

router.post('/backup', asyncHandler(async (req, res) => {
  const { salt, iv, wrappedKey, verifier, iterations } = req.body || {};
  if (!salt || !iv || !wrappedKey || !verifier) throw new ApiError(400, 'بيانات غير مكتملة');
  const iters = Number(iterations) || 0;
  if (iters < 200000 || iters > 2000000) throw new ApiError(400, 'عدد تكرارات KDF غير مقبول');
  if ([wrappedKey, salt, iv, verifier].some((v) => String(v).length > 20000)) {
    throw new ApiError(400, 'بيانات كبيرة بشكل غير متوقع');
  }
  await keys.upsertKeyBackup(req.user.id, { salt, iv, wrappedKey, verifier, iterations: iters });
  res.json({ success: true });
}));

router.post('/backup/unlock', asyncHandler(async (req, res) => {
  const { verifier } = req.body || {};
  if (!verifier || typeof verifier !== 'string') throw new ApiError(400, 'verifier مطلوب');

  const backup = await keys.getKeyBackup(req.user.id);
  if (!backup) throw new ApiError(404, 'لا يوجد نسخة احتياطية');

  if (keys.isLocked(backup)) {
    const err = new ApiError(429, `تم تجاوز عدد المحاولات، حاول بعد ${keys.PIN_LOCKOUT_MINUTES} دقيقة`);
    err.lockedUntil = backup.locked_until;
    throw err;
  }

  const match = keys.constantTimeEquals(verifier, backup.verifier);
  if (!match) {
    const attempts = (backup.failed_attempts || 0) + 1;
    await keys.incrementFailedAttempts(req.user.id);
    if (attempts >= keys.PIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + keys.PIN_LOCKOUT_MINUTES * 60000)
        .toISOString().replace('T', ' ').slice(0, 19);
      await keys.lockKeyBackup(req.user.id, lockedUntil);
      return res.status(429).json({
        error: `تم تجاوز عدد المحاولات، حاول بعد ${keys.PIN_LOCKOUT_MINUTES} دقيقة`,
        lockedUntil,
      });
    }
    return res.status(401).json({
      error: 'رمز PIN غير صحيح',
      attemptsRemaining: Math.max(0, keys.PIN_MAX_ATTEMPTS - attempts),
    });
  }

  await keys.resetFailedAttempts(req.user.id);
  res.json({ wrappedKey: backup.wrapped_key, iv: backup.iv });
}));

router.delete('/backup', asyncHandler(async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { password } = req.body || {};
  const dbUser = await users.getUserByIdFull(req.user.id);
  if (!dbUser || !password || !bcrypt.compareSync(String(password), dbUser.password)) {
    throw new ApiError(401, 'كلمة المرور غير صحيحة');
  }
  await keys.deleteKeyBackup(req.user.id);
  res.json({ success: true });
}));

module.exports = router;

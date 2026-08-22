const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const users = require('../services/users.service');

const router = express.Router();

/**
 * لا يوجد تسجيل دخول/تسجيل حساب في orbithub — هذا فرع مراسلات تابع لـ Hostaka
 * ويستخدم نفس جلسة Hostaka (JWT موقّع بنفس JWT_SECRET، يوصل عبر كوكي
 * hostaka_token المشتركة على نطاق .hostaka.fun أو عبر Authorization: Bearer).
 * الواجهة الأمامية تستخدم هذا المسار فقط للتأكد من صلاحية الجلسة وجلب بيانات
 * المستخدم الكاملة من قاعدة البيانات (نفس قاعدة بيانات Hostaka).
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await users.getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'الحساب غير موجود' });
  res.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar,
    role: user.role,
  });
}));

module.exports = router;

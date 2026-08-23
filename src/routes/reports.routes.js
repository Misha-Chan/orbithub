const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { run } = require('../db/client');
const users = require('../services/users.service');

const router = express.Router();
router.use(requireAuth);

/**
 * إبلاغ عن رسالة — نفس جدول reports المستخدم أصلاً بمشروع Hostaka بالضبط
 * (نفس الأعمدة، نفس المعنى)، فبلاغات orbithub تظهر تلقائياً بلوحة إدارة
 * Hostaka (/api/admin/reports) بدون أي تعديل هناك. type ثابت 'message'.
 */
router.post('/', asyncHandler(async (req, res) => {
  const { target_id, target_owner_username, subject, reason } = req.body || {};
  if (!reason?.trim()) throw new ApiError(400, 'الرجاء كتابة تفاصيل البلاغ');

  const me = await users.getUserById(req.user.id);
  let ownerId = null, ownerName = '';
  if (target_owner_username) {
    const owner = await users.getUserByUsername(target_owner_username);
    if (owner) { ownerId = owner.id; ownerName = owner.display_name || owner.username; }
  }

  await run(
    `INSERT INTO reports (reporter_id, reporter_name, type, target_id, target_owner_id, target_owner_name, subject, reason)
     VALUES (?, ?, 'message', ?, ?, ?, ?, ?)`,
    [
      me.id, me.display_name || me.username,
      target_id || null, ownerId, ownerName,
      (subject || '').trim(), reason.trim(),
    ]
  );
  res.json({ success: true });
}));

module.exports = router;

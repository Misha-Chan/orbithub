const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const users = require('../services/users.service');
const privacy = require('../services/privacy.service');

const router = express.Router();
router.use(requireAuth);

router.get('/read-receipts', asyncHandler(async (req, res) => {
  const user = await users.getUserById(req.user.id);
  res.json({ enabled: user?.read_receipts !== 0 });
}));

router.put('/read-receipts', asyncHandler(async (req, res) => {
  await users.setReadReceipts(req.user.id, !!req.body?.enabled);
  res.json({ success: true });
}));

const ALLOWED_PRIVACY = ['everyone', 'followers', 'none'];
router.put('/message-privacy', asyncHandler(async (req, res) => {
  const value = req.body?.value;
  if (!ALLOWED_PRIVACY.includes(value)) throw new ApiError(400, 'قيمة غير صالحة');
  await users.setMessagePrivacy(req.user.id, value);
  res.json({ success: true });
}));

router.post('/block/:username', asyncHandler(async (req, res) => {
  const target = await users.getUserByUsername(req.params.username);
  if (!target) throw new ApiError(404, 'غير موجود');
  await privacy.blockUser(req.user.id, target.id);
  res.json({ success: true });
}));

router.delete('/block/:username', asyncHandler(async (req, res) => {
  const target = await users.getUserByUsername(req.params.username);
  if (!target) throw new ApiError(404, 'غير موجود');
  await privacy.unblockUser(req.user.id, target.id);
  res.json({ success: true });
}));

module.exports = router;

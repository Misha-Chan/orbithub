const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const typing = require('../services/typing.service');

const router = express.Router();
router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const chatKey = String(req.body?.chat_key || '').trim();
  if (!chatKey) throw new ApiError(400, 'chat_key مطلوب');
  if (req.body?.stop) await typing.clearTyping(chatKey, req.user.id);
  else await typing.setTyping(chatKey, req.user.id);
  res.json({ success: true });
}));

router.get('/:chatKey', asyncHandler(async (req, res) => {
  res.json({ typing: await typing.getTypingUsers(req.params.chatKey, req.user.id) });
}));

module.exports = router;

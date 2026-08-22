const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError, toIntOrThrow } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const msgs = require('../services/messages.service');
const users = require('../services/users.service');
const { assertCanMessage } = require('../services/privacy.service');

const router = express.Router();
router.use(requireAuth);

router.get('/unread', asyncHandler(async (req, res) => {
  res.json(await msgs.unreadCount(req.user.id));
}));

router.get('/conversations', asyncHandler(async (req, res) => {
  res.json(await msgs.getConversations(req.user.id));
}));

router.get('/reactions', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const result = {};
  for (const id of ids) {
    const reactions = await msgs.getReactions(id);
    const mine = (await msgs.getUserReaction(id, req.user.id))?.emoji || null;
    if (reactions.length || mine) result[id] = { reactions, userReaction: mine };
  }
  res.json(result);
}));

router.get('/:username', asyncHandler(async (req, res) => {
  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  // نفس نمط موجود أصلاً بـ Hostaka (requireAuth هناك): ما ننتظر عملية
  // "تعليم كمقروءة" قبل إرجاع الرسائل — هذا استطلاع دوري كل 2.5 ثانية،
  // فأي تأخير إضافي هون (قفل كتابة، بطء عرضي) يتراكم ويسبب مهلة/504.
  // القراءة نفسها لا تتأثر: نرجّع الرسائل فوراً، والتحديث يصير بالخلفية.
  msgs.markRead(other.id, req.user.id).catch((e) => console.error('markRead failed:', e));
  res.json(await msgs.getConversation(req.user.id, other.id, {
    limit: Number(req.query.limit) || 200,
    beforeId: req.query.before ? Number(req.query.before) : null,
  }));
}));

router.delete('/:username', asyncHandler(async (req, res) => {
  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  await msgs.deleteConversation(req.user.id, other.id);
  res.json({ success: true });
}));

router.get('/:username/media', asyncHandler(async (req, res) => {
  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  res.json(await msgs.getConversationMedia(req.user.id, other.id));
}));

router.get('/:username/nickname', asyncHandler(async (req, res) => {
  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  const row = await msgs.getNickname(req.user.id, other.id);
  res.json({ nickname: row?.nickname || '' });
}));

router.put('/:username/nickname', asyncHandler(async (req, res) => {
  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  await msgs.setNickname(req.user.id, other.id, String(req.body?.nickname || '').trim().slice(0, 40));
  res.json({ success: true });
}));

router.post('/react/:id', asyncHandler(async (req, res) => {
  const id = toIntOrThrow(req.params.id, 'معرف الرسالة');
  const emoji = req.body?.emoji || 'heart';
  const existing = await msgs.getUserReaction(id, req.user.id);
  if (existing && existing.emoji === emoji) {
    await msgs.removeReaction(id, req.user.id);
  } else {
    await msgs.addReaction(id, req.user.id, emoji);
  }
  const reactions = await msgs.getReactions(id);
  const userReaction = (await msgs.getUserReaction(id, req.user.id))?.emoji || null;
  res.json({ success: true, reactions, userReaction });
}));

router.post('/:username', asyncHandler(async (req, res) => {
  const { content, image, reply_to, iv, encrypted } = req.body || {};
  if (!content?.trim() && !image) throw new ApiError(400, 'الرسالة فارغة');

  const other = await users.getUserByUsername(req.params.username);
  if (!other) throw new ApiError(404, 'غير موجود');
  await assertCanMessage(req.user.id, other);

  const me = await users.getUserById(req.user.id);
  const message = await msgs.sendMessage({
    fromId: me.id, toId: other.id,
    fromName: me.display_name || me.username, toName: other.display_name || other.username,
    content: content?.trim() || '', image: image || '',
    replyTo: reply_to ? toIntOrThrow(reply_to, 'reply_to') : null,
    iv: iv || '', encrypted: !!encrypted,
  });
  res.status(201).json(message);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = toIntOrThrow(req.params.id, 'معرف الرسالة');
  const msg = await msgs.getMessageById(id);
  if (!msg) throw new ApiError(404, 'غير موجود');
  if (msg.from_id != req.user.id) throw new ApiError(403, 'غير مسموح');

  const { content, iv } = req.body || {};
  if (!content?.trim()) throw new ApiError(400, 'الرسالة فارغة');
  res.json(await msgs.updateMessage(id, content.trim(), iv || ''));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toIntOrThrow(req.params.id, 'معرف الرسالة');
  const msg = await msgs.getMessageById(id);
  if (!msg) throw new ApiError(404, 'غير موجود');
  const me = await users.getUserById(req.user.id);
  if (msg.from_id != req.user.id && me?.role !== 'admin') throw new ApiError(403, 'غير مسموح');
  await msgs.deleteMessage(id);
  res.json({ success: true });
}));

module.exports = router;

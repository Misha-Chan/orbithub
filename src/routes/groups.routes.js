const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError, toIntOrThrow } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const groups = require('../services/groups.service');
const users = require('../services/users.service');

const router = express.Router();
router.use(requireAuth);

/** ميدلوير: يتأكد أن المستخدم عضو بالمجموعة، ويحقن req.membership */
const requireMember = asyncHandler(async (req, res, next) => {
  const groupId = toIntOrThrow(req.params.id, 'معرف المجموعة');
  const membership = await groups.getMembership(groupId, req.user.id);
  if (!membership) throw new ApiError(403, 'لست عضواً في هذه المجموعة');
  req.groupId = groupId;
  req.membership = membership;
  next();
});

/** ميدلوير: يتأكد أن المستخدم owner أو admin بالمجموعة */
function requireGroupAdmin(req, res, next) {
  if (!['owner', 'admin'].includes(req.membership.role)) {
    return next(new ApiError(403, 'صلاحية غير كافية'));
  }
  next();
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await groups.getUserGroups(req.user.id));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description, avatar } = req.body || {};
  if (!name?.trim()) throw new ApiError(400, 'اسم المجموعة مطلوب');
  res.status(201).json(await groups.createGroup(req.user.id, { name: name.trim(), description, avatar }));
}));

router.get('/:id', requireMember, asyncHandler(async (req, res) => {
  const group = await groups.getGroupById(req.groupId);
  const members = await groups.getMembers(req.groupId);
  res.json({ ...group, members, myRole: req.membership.role });
}));

router.put('/:id', requireMember, requireGroupAdmin, asyncHandler(async (req, res) => {
  const { name, description, avatar } = req.body || {};
  res.json(await groups.updateGroup(req.groupId, { name, description, avatar }));
}));

router.delete('/:id', requireMember, asyncHandler(async (req, res) => {
  if (req.membership.role !== 'owner') throw new ApiError(403, 'فقط مالك المجموعة يقدر يحذفها');
  await groups.deleteGroup(req.groupId);
  res.json({ success: true });
}));

router.post('/:id/members', requireMember, requireGroupAdmin, asyncHandler(async (req, res) => {
  const { username } = req.body || {};
  const target = await users.getUserByUsername(username);
  if (!target) throw new ApiError(404, 'المستخدم غير موجود');
  await groups.addMember(req.groupId, target.id);
  res.json({ success: true });
}));

router.delete('/:id/members/:uid', requireMember, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  const isSelf = targetId === req.user.id;
  if (!isSelf && !['owner', 'admin'].includes(req.membership.role)) {
    throw new ApiError(403, 'صلاحية غير كافية');
  }
  await groups.removeMember(req.groupId, targetId);
  res.json({ success: true });
}));

router.put('/:id/members/:uid/role', requireMember, requireGroupAdmin, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  const role = req.body?.role;
  if (!['admin', 'member'].includes(role)) throw new ApiError(400, 'دور غير صالح');
  await groups.setMemberRole(req.groupId, targetId, role);
  res.json({ success: true });
}));

router.put('/:id/members/:uid/nickname', requireMember, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  // كل عضو يقدر يغيّر كنيته هو فقط، إلا لو كان أدمن/مالك
  if (targetId !== req.user.id && !['owner', 'admin'].includes(req.membership.role)) {
    throw new ApiError(403, 'صلاحية غير كافية');
  }
  await groups.setMemberNickname(req.groupId, targetId, String(req.body?.nickname || '').trim().slice(0, 40));
  res.json({ success: true });
}));

router.get('/:id/messages', requireMember, asyncHandler(async (req, res) => {
  res.json(await groups.getGroupMessages(req.groupId, {
    limit: Number(req.query.limit) || 200,
    beforeId: req.query.before ? Number(req.query.before) : null,
  }));
}));

router.get('/:id/media', requireMember, asyncHandler(async (req, res) => {
  res.json(await groups.getGroupMedia(req.groupId));
}));

router.post('/:id/read', requireMember, asyncHandler(async (req, res) => {
  await groups.markGroupRead(req.groupId, req.user.id);
  res.json({ success: true });
}));

router.post('/:id/messages', requireMember, asyncHandler(async (req, res) => {
  const { content, image } = req.body || {};
  if (!content?.trim() && !image) throw new ApiError(400, 'الرسالة فارغة');
  const me = await users.getUserById(req.user.id);
  const message = await groups.sendGroupMessage({
    groupId: req.groupId, userId: req.user.id,
    fromName: req.membership.nickname || me.display_name || me.username,
    fromAvatar: me.avatar, content: content?.trim() || '', image: image || '',
  });
  res.status(201).json(message);
}));

router.put('/:id/messages/:mid', requireMember, asyncHandler(async (req, res) => {
  const mid = toIntOrThrow(req.params.mid, 'معرف الرسالة');
  const msg = await groups.getGroupMessageById(mid);
  if (!msg || msg.group_id !== req.groupId) throw new ApiError(404, 'غير موجود');
  if (msg.user_id !== req.user.id) throw new ApiError(403, 'غير مسموح');
  const { content } = req.body || {};
  if (!content?.trim()) throw new ApiError(400, 'الرسالة فارغة');
  res.json(await groups.updateGroupMessage(mid, content.trim()));
}));

router.delete('/:id/messages/:mid', requireMember, asyncHandler(async (req, res) => {
  const mid = toIntOrThrow(req.params.mid, 'معرف الرسالة');
  const msg = await groups.getGroupMessageById(mid);
  if (!msg || msg.group_id !== req.groupId) throw new ApiError(404, 'غير موجود');
  const canModerate = ['owner', 'admin'].includes(req.membership.role);
  if (msg.user_id !== req.user.id && !canModerate) throw new ApiError(403, 'غير مسموح');
  await groups.deleteGroupMessage(mid);
  res.json({ success: true });
}));

router.post('/:gid/messages/:mid/react', asyncHandler(async (req, res) => {
  const groupId = toIntOrThrow(req.params.gid, 'معرف المجموعة');
  const membership = await groups.getMembership(groupId, req.user.id);
  if (!membership) throw new ApiError(403, 'لست عضواً في هذه المجموعة');

  const mid = toIntOrThrow(req.params.mid, 'معرف الرسالة');
  const emoji = req.body?.emoji || 'heart';
  const existing = await groups.getUserReaction(mid, req.user.id);
  if (existing && existing.emoji === emoji) {
    await groups.removeReaction(mid, req.user.id);
  } else {
    await groups.addReaction(mid, req.user.id, emoji);
  }
  const reactions = await groups.getReactions(mid);
  const userReaction = (await groups.getUserReaction(mid, req.user.id))?.emoji || null;
  res.json({ success: true, reactions, userReaction });
}));

router.get('/:id/messages/reactions', requireMember, asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const result = {};
  for (const mid of ids) {
    const reactions = await groups.getReactions(mid);
    const mine = (await groups.getUserReaction(mid, req.user.id))?.emoji || null;
    if (reactions.length || mine) result[mid] = { reactions, userReaction: mine };
  }
  res.json(result);
}));

module.exports = router;

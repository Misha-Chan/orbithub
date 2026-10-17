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

/** اسم المتصفح (صاحب الإجراء) لعرضه في رسائل النظام */
async function actorName(req) {
  const me = await users.getUserById(req.user.id);
  return (me && (me.display_name || me.username)) || 'مستخدم';
}
function memberLabel(u) { return u ? (u.display_name || u.username) : 'عضو'; }

/** رسائل النظام تُخزَّن ككائن JSON (حدث + وسائط) بدل نص جاهز، حتى يعرضها
 *  العميل بلغة المستخدم الحالية (عربي/إنجليزي) بدل لغة ثابتة بالسيرفر. */
function sysEvent(e, params) { return JSON.stringify({ e, ...(params || {}) }); }

router.get('/', asyncHandler(async (req, res) => {
  res.json(await groups.getUserGroups(req.user.id));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description, avatar } = req.body || {};
  if (!name?.trim()) throw new ApiError(400, 'اسم المجموعة مطلوب');
  const group = await groups.createGroup(req.user.id, { name: name.trim(), description, avatar });
  await groups.addSystemMessage(group.id, req.user.id, sysEvent('created', { actor: await actorName(req) }));
  res.status(201).json(group);
}));

router.get('/:id', requireMember, asyncHandler(async (req, res) => {
  const group = await groups.getGroupById(req.groupId);
  const members = await groups.getMembers(req.groupId);
  res.json({ ...group, members, myRole: req.membership.role });
}));

router.put('/:id', requireMember, requireGroupAdmin, asyncHandler(async (req, res) => {
  const { name, description, avatar } = req.body || {};
  const before = await groups.getGroupById(req.groupId);
  const updated = await groups.updateGroup(req.groupId, { name, description, avatar });
  const who = await actorName(req);
  // كل تغيير بالإعدادات يُسجَّل كرسالة نظام تظهر بنص خافت عند كل الأعضاء.
  if (avatar !== undefined && avatar !== before.avatar) {
    await groups.addSystemMessage(req.groupId, req.user.id, sysEvent('photo', { actor: who }));
  }
  if (name !== undefined && name !== before.name) {
    await groups.addSystemMessage(req.groupId, req.user.id, sysEvent('name', { actor: who, value: updated.name }));
  }
  if (description !== undefined && description !== before.description) {
    await groups.addSystemMessage(req.groupId, req.user.id, sysEvent('desc', { actor: who }));
  }
  res.json(updated);
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
  if (await groups.getMembership(req.groupId, target.id)) { res.json({ success: true }); return; }
  await groups.addMember(req.groupId, target.id);
  await groups.addSystemMessage(req.groupId, req.user.id, sysEvent('member_added', { actor: await actorName(req), target: memberLabel(target) }));
  res.json({ success: true });
}));

router.delete('/:id/members/:uid', requireMember, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  const isSelf = targetId === req.user.id;
  if (!isSelf && !['owner', 'admin'].includes(req.membership.role)) {
    throw new ApiError(403, 'صلاحية غير كافية');
  }
  const target = await users.getUserById(targetId);
  if (!(await groups.getMembership(req.groupId, targetId))) { res.json({ success: true }); return; }
  await groups.removeMember(req.groupId, targetId);
  const who = await actorName(req);
  await groups.addSystemMessage(
    req.groupId, req.user.id,
    isSelf ? sysEvent('member_left', { actor: who }) : sysEvent('member_removed', { actor: who, target: memberLabel(target) })
  );
  res.json({ success: true });
}));

router.put('/:id/members/:uid/role', requireMember, requireGroupAdmin, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  const role = req.body?.role;
  if (!['admin', 'member'].includes(role)) throw new ApiError(400, 'دور غير صالح');
  const mem = await groups.getMembership(req.groupId, targetId);
  if (!mem || mem.role === role) { res.json({ success: true }); return; }
  await groups.setMemberRole(req.groupId, targetId, role);
  const target = await users.getUserById(targetId);
  const label = memberLabel(target);
  await groups.addSystemMessage(
    req.groupId, req.user.id,
    sysEvent(role === 'admin' ? 'role_admin' : 'role_member', { actor: await actorName(req), target: label })
  );
  res.json({ success: true });
}));

router.put('/:id/members/:uid/nickname', requireMember, asyncHandler(async (req, res) => {
  const targetId = toIntOrThrow(req.params.uid, 'معرف العضو');
  const isSelf = targetId === req.user.id;
  // كل عضو يقدر يغيّر كنيته هو فقط، إلا لو كان أدمن/مالك
  if (!isSelf && !['owner', 'admin'].includes(req.membership.role)) {
    throw new ApiError(403, 'صلاحية غير كافية');
  }
  const nickname = String(req.body?.nickname || '').trim().slice(0, 40);
  const mem = await groups.getMembership(req.groupId, targetId);
  if (mem && (mem.nickname || '') === nickname) { res.json({ success: true }); return; }
  await groups.setMemberNickname(req.groupId, targetId, nickname);
  const who = await actorName(req);
  const label = memberLabel(await users.getUserById(targetId));
  const event = isSelf
    ? (nickname ? 'nick_self' : 'nick_self_clear')
    : (nickname ? 'nick_other' : 'nick_other_clear');
  await groups.addSystemMessage(req.groupId, req.user.id, sysEvent(event, {
    actor: who, target: isSelf ? who : label, value: nickname,
  }));
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

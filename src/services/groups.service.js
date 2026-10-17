const { run, rows, first } = require('../db/client');

async function createGroup(creatorId, { name, description, avatar }) {
  const r = await run(
    `INSERT INTO groups (name, description, avatar, created_by) VALUES (?, ?, ?, ?)`,
    [name, description || '', avatar || '', creatorId]
  );
  const groupId = Number(r.lastInsertRowid);
  await run(
    `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`,
    [groupId, creatorId]
  );
  return getGroupById(groupId);
}

async function getGroupById(id) {
  return first(await run(`SELECT * FROM groups WHERE id = ?`, [id]));
}

async function getUserGroups(userId) {
  return rows(await run(
    `SELECT g.*, gm.role, gm.nickname
     FROM groups g JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.created_at DESC`,
    [userId]
  ));
}

async function getMembership(groupId, userId) {
  return first(await run(
    `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId]
  ));
}

async function getMembers(groupId) {
  return rows(await run(
    `SELECT gm.user_id, gm.role, gm.nickname, gm.joined_at, u.username, u.display_name, u.avatar
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at`,
    [groupId]
  ));
}

async function updateGroup(id, { name, description, avatar }) {
  await run(
    `UPDATE groups SET name = COALESCE(?, name), description = COALESCE(?, description), avatar = COALESCE(?, avatar) WHERE id = ?`,
    [name ?? null, description ?? null, avatar ?? null, id]
  );
  return getGroupById(id);
}

async function deleteGroup(id) {
  await run(`DELETE FROM groups WHERE id = ?`, [id]);
}

async function addMember(groupId, userId, role = 'member') {
  await run(
    `INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`,
    [groupId, userId, role]
  );
}

async function removeMember(groupId, userId) {
  await run(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, [groupId, userId]);
}

async function setMemberRole(groupId, userId, role) {
  await run(`UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?`, [role, groupId, userId]);
}

async function setMemberNickname(groupId, userId, nickname) {
  await run(`UPDATE group_members SET nickname = ? WHERE group_id = ? AND user_id = ?`, [nickname, groupId, userId]);
}

async function markGroupRead(groupId, userId) {
  await run(
    `UPDATE group_members SET last_read_at = datetime('now') WHERE group_id = ? AND user_id = ?`,
    [groupId, userId]
  );
}

// ---- رسائل المجموعة ----
async function sendGroupMessage({ groupId, userId, fromName, fromAvatar, content, image }) {
  const r = await run(
    `INSERT INTO group_messages (group_id, user_id, from_name, from_avatar, content, image, type)
     VALUES (?, ?, ?, ?, ?, ?, 'text')`,
    [groupId, userId, fromName, fromAvatar || '', content || '', image || '']
  );
  return getGroupMessageById(Number(r.lastInsertRowid));
}

/// رسالة نظام (تغيير صورة المجموعة/الكنية/إضافة عضو...) تظهر بنص خافت وسط
/// المحادثة عند كل الأعضاء — تُخزَّن كصف عادي بنوع 'system' حتى تصل للجميع
/// مع الاستطلاع الدوري، بدل ما تكون مخفية عند الطرف اللي عمل التغيير فقط.
async function addSystemMessage(groupId, userId, content) {
  const r = await run(
    `INSERT INTO group_messages (group_id, user_id, from_name, from_avatar, content, image, type)
     VALUES (?, ?, '', '', ?, '', 'system')`,
    [groupId, userId, String(content || '').slice(0, 300)]
  );
  return getGroupMessageById(Number(r.lastInsertRowid));
}

async function getGroupMessageById(id) {
  return first(await run(`SELECT * FROM group_messages WHERE id = ?`, [id]));
}

async function getGroupMessages(groupId, { limit = 200, beforeId = null } = {}) {
  const params = [groupId];
  let sql = `SELECT * FROM group_messages WHERE group_id = ?`;
  if (beforeId) {
    sql += ` AND id < ?`;
    params.push(beforeId);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const list = rows(await run(sql, params));
  return list.reverse();
}

async function getGroupMedia(groupId) {
  return rows(await run(
    `SELECT id, image, created_at FROM group_messages WHERE group_id = ? AND image != '' ORDER BY id DESC`,
    [groupId]
  ));
}

async function updateGroupMessage(id, content) {
  await run(`UPDATE group_messages SET content = ?, edited = 1 WHERE id = ?`, [content, id]);
  return getGroupMessageById(id);
}

async function deleteGroupMessage(id) {
  await run(`DELETE FROM group_messages WHERE id = ?`, [id]);
}

// ---- تفاعلات رسائل المجموعة ----
async function getUserReaction(messageId, userId) {
  return first(await run(
    `SELECT * FROM group_message_reactions WHERE message_id = ? AND user_id = ?`,
    [messageId, userId]
  ));
}

async function addReaction(messageId, userId, emoji) {
  await run(
    `INSERT INTO group_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
     ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
    [messageId, userId, emoji]
  );
}

async function removeReaction(messageId, userId) {
  await run(`DELETE FROM group_message_reactions WHERE message_id = ? AND user_id = ?`, [messageId, userId]);
}

async function getReactions(messageId) {
  return rows(await run(`SELECT user_id, emoji FROM group_message_reactions WHERE message_id = ?`, [messageId]));
}

module.exports = {
  createGroup, getGroupById, getUserGroups, getMembership, getMembers,
  updateGroup, deleteGroup, addMember, removeMember, setMemberRole, setMemberNickname, markGroupRead,
  sendGroupMessage, getGroupMessageById, getGroupMessages, getGroupMedia, updateGroupMessage, deleteGroupMessage,
  addSystemMessage,
  getUserReaction, addReaction, removeReaction, getReactions,
};

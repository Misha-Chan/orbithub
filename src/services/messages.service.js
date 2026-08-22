const { run, rows, first } = require('../db/client');

async function sendMessage({ fromId, toId, fromName, toName, content, image, replyTo, iv, encrypted }) {
  const r = await run(
    `INSERT INTO messages (from_id, to_id, from_name, to_name, content, image, reply_to, iv, encrypted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fromId, toId, fromName, toName, content || '', image || '', replyTo || null, iv || '', encrypted ? 1 : 0]
  );
  return getMessageById(Number(r.lastInsertRowid));
}

async function getMessageById(id) {
  return first(await run(`SELECT * FROM messages WHERE id = ?`, [id]));
}

/** كل الرسائل بين طرفين، بترتيب زمني تصاعدي */
async function getConversation(userA, userB, { limit = 200, beforeId = null } = {}) {
  const params = [userA, userB, userB, userA];
  let sql = `
    SELECT * FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
  `;
  if (beforeId) {
    sql += ` AND id < ? `;
    params.push(beforeId);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const list = rows(await run(sql, params));
  return list.reverse();
}

async function markRead(fromId, toId) {
  await run(`UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = ? AND read = 0`, [fromId, toId]);
}

async function unreadCount(userId) {
  const r = first(await run(
    `SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND read = 0`,
    [userId]
  ));
  return { count: Number(r?.c || 0) };
}

/** قائمة المحادثات: آخر رسالة مع كل طرف + عدد غير المقروء */
async function getConversations(userId) {
  const list = rows(await run(
    `
    WITH pairs AS (
      SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other_id, id, created_at
      FROM messages
      WHERE from_id = ? OR to_id = ?
    ),
    latest AS (
      SELECT other_id, MAX(id) AS last_id
      FROM pairs
      GROUP BY other_id
    )
    SELECT
      u.id, u.username, u.display_name, u.avatar,
      m.content AS last_content, m.image AS last_image, m.created_at AS last_at,
      m.from_id AS last_from_id, m.read AS last_read,
      (SELECT COUNT(*) FROM messages WHERE from_id = u.id AND to_id = ? AND read = 0) AS unread
    FROM latest
    JOIN users u ON u.id = latest.other_id
    JOIN messages m ON m.id = latest.last_id
    ORDER BY m.created_at DESC
    `,
    [userId, userId, userId, userId]
  ));
  return list;
}

async function deleteConversation(userA, userB) {
  await run(
    `DELETE FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`,
    [userA, userB, userB, userA]
  );
}

async function getConversationMedia(userA, userB) {
  return rows(await run(
    `SELECT id, image, created_at FROM messages
     WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND image != ''
     ORDER BY id DESC`,
    [userA, userB, userB, userA]
  ));
}

async function updateMessage(id, content, iv) {
  await run(`UPDATE messages SET content = ?, iv = ?, edited = 1 WHERE id = ?`, [content, iv || '', id]);
  return getMessageById(id);
}

async function deleteMessage(id) {
  await run(`DELETE FROM messages WHERE id = ?`, [id]);
}

// ---- تفاعلات ----
async function getUserReaction(messageId, userId) {
  return first(await run(
    `SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?`,
    [messageId, userId]
  ));
}

async function addReaction(messageId, userId, emoji) {
  await run(
    `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
     ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
    [messageId, userId, emoji]
  );
}

async function removeReaction(messageId, userId) {
  await run(`DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?`, [messageId, userId]);
}

async function getReactions(messageId) {
  return rows(await run(
    `SELECT user_id, emoji FROM message_reactions WHERE message_id = ?`,
    [messageId]
  ));
}

// ---- كنية خاصة ----
async function getNickname(ownerId, targetId) {
  return first(await run(
    `SELECT nickname FROM dm_nicknames WHERE owner_id = ? AND target_id = ?`,
    [ownerId, targetId]
  ));
}

async function setNickname(ownerId, targetId, nickname) {
  await run(
    `INSERT INTO dm_nicknames (owner_id, target_id, nickname) VALUES (?, ?, ?)
     ON CONFLICT(owner_id, target_id) DO UPDATE SET nickname = excluded.nickname`,
    [ownerId, targetId, nickname]
  );
}

module.exports = {
  sendMessage, getMessageById, getConversation, markRead, unreadCount, getConversations,
  deleteConversation, getConversationMedia, updateMessage, deleteMessage,
  getUserReaction, addReaction, removeReaction, getReactions,
  getNickname, setNickname,
};

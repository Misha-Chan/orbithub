const { run, rows } = require('../db/client');

// أي مؤشر كتابة أقدم من هالمدة يُعتبر منتهي الصلاحية (المستخدم توقف عن الكتابة
// ولم يرسل إشارة "stop" — مثلاً أغلق التبويب فجأة).
const TYPING_TTL_SECONDS = 6;

async function setTyping(chatKey, userId) {
  await run(
    `INSERT INTO typing_status (chat_key, user_id, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(chat_key, user_id) DO UPDATE SET updated_at = datetime('now')`,
    [chatKey, userId]
  );
}

async function clearTyping(chatKey, userId) {
  await run(`DELETE FROM typing_status WHERE chat_key = ? AND user_id = ?`, [chatKey, userId]);
}

async function getTypingUsers(chatKey, excludeUserId) {
  const list = rows(await run(
    `SELECT ts.user_id, u.username, u.display_name FROM typing_status ts
     JOIN users u ON u.id = ts.user_id
     WHERE ts.chat_key = ? AND ts.user_id != ?
       AND ts.updated_at > datetime('now', '-${TYPING_TTL_SECONDS} seconds')`,
    [chatKey, excludeUserId]
  ));
  return list;
}

module.exports = { setTyping, clearTyping, getTypingUsers };

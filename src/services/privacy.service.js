const { run, first } = require('../db/client');
const { isFollowing } = require('./users.service');

async function isBlockedEitherWay(userA, userB) {
  const r = first(await run(
    `SELECT id FROM blocks
     WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)
     LIMIT 1`,
    [userA, userB, userB, userA]
  ));
  return !!r;
}

async function blockUser(userId, targetId) {
  await run(
    `INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)`,
    [userId, targetId]
  );
}

async function unblockUser(userId, targetId) {
  await run(`DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?`, [userId, targetId]);
}

/** يتحقق أن sender مسموح له يراسل recipient حسب إعدادات خصوصية recipient */
async function assertCanMessage(senderId, recipient) {
  if (Number(recipient.id) === Number(senderId)) return; // مسموح تراسل نفسك (ملاحظات)
  if (await isBlockedEitherWay(senderId, recipient.id)) {
    const e = new Error('لا يمكن إرسال رسالة، يوجد حظر بينكما');
    e.status = 403;
    throw e;
  }
  if (recipient.message_privacy === 'none') {
    const e = new Error('هذا المستخدم لا يسمح لأحد بمراسلته');
    e.status = 403;
    throw e;
  }
  if (recipient.message_privacy === 'followers') {
    const senderFollowsRecipient = await isFollowing(senderId, recipient.id);
    if (!senderFollowsRecipient) {
      const e = new Error('هذا المستخدم يسمح فقط لمتابعيه بمراسلته');
      e.status = 403;
      throw e;
    }
  }
}

module.exports = { isBlockedEitherWay, blockUser, unblockUser, assertCanMessage };

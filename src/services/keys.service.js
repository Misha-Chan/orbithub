const crypto = require('crypto');
const { run, first } = require('../db/client');

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

async function getKeyBackup(userId) {
  return first(await run(`SELECT * FROM key_backups WHERE user_id = ?`, [userId]));
}

async function upsertKeyBackup(userId, { salt, iv, wrappedKey, verifier, iterations }) {
  await run(
    `INSERT INTO key_backups (user_id, salt, iv, wrapped_key, verifier, iterations, failed_attempts, locked_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       salt = excluded.salt, iv = excluded.iv, wrapped_key = excluded.wrapped_key,
       verifier = excluded.verifier, iterations = excluded.iterations,
       failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')`,
    [userId, salt, iv, wrappedKey, verifier, iterations]
  );
}

async function deleteKeyBackup(userId) {
  await run(`DELETE FROM key_backups WHERE user_id = ?`, [userId]);
}

async function incrementFailedAttempts(userId) {
  await run(`UPDATE key_backups SET failed_attempts = failed_attempts + 1 WHERE user_id = ?`, [userId]);
}

async function resetFailedAttempts(userId) {
  await run(`UPDATE key_backups SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?`, [userId]);
}

async function lockKeyBackup(userId, lockedUntilIso) {
  await run(`UPDATE key_backups SET locked_until = ? WHERE user_id = ?`, [lockedUntilIso, userId]);
}

function isLocked(backup) {
  if (!backup?.locked_until) return false;
  // القيمة مخزّنة بصيغة 'YYYY-MM-DD HH:MM:SS' UTC (نفس صيغة sqlite datetime('now'))
  return new Date(backup.locked_until.replace(' ', 'T') + 'Z').getTime() > Date.now();
}

/** مقارنة بوقت ثابت لتفادي تسريب فرق التوقيت (timing attack) عبر الشبكة */
function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  PIN_MAX_ATTEMPTS, PIN_LOCKOUT_MINUTES,
  getKeyBackup, upsertKeyBackup, deleteKeyBackup,
  incrementFailedAttempts, resetFailedAttempts, lockKeyBackup,
  isLocked, constantTimeEquals,
};

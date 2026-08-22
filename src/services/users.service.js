const { run, rows, first } = require('../db/client');

async function createUser({ username, email, passwordHash, displayName }) {
  const r = await run(
    `INSERT INTO users (username, email, password, display_name) VALUES (?, ?, ?, ?)`,
    [username, email, passwordHash, displayName || username]
  );
  return Number(r.lastInsertRowid);
}

async function getUserByEmail(email) {
  return first(await run(`SELECT * FROM users WHERE email = ?`, [email]));
}

async function getUserByUsername(username) {
  return first(await run(`SELECT * FROM users WHERE username = ?`, [username]));
}

async function getUserById(id) {
  return first(await run(
    `SELECT id, username, email, display_name, avatar, role, public_key, message_privacy, read_receipts
     FROM users WHERE id = ?`,
    [id]
  ));
}

async function getUserByIdFull(id) {
  return first(await run(`SELECT * FROM users WHERE id = ?`, [id]));
}

async function setPublicKey(userId, publicKey) {
  await run(`UPDATE users SET public_key = ? WHERE id = ?`, [publicKey, userId]);
}

async function setMessagePrivacy(userId, value) {
  await run(`UPDATE users SET message_privacy = ? WHERE id = ?`, [value, userId]);
}

async function setReadReceipts(userId, enabled) {
  await run(`UPDATE users SET read_receipts = ? WHERE id = ?`, [enabled ? 1 : 0, userId]);
}

async function isFollowing(followerId, followedId) {
  const r = first(await run(
    `SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?`,
    [followerId, followedId]
  ));
  return !!r;
}

module.exports = {
  createUser, getUserByEmail, getUserByUsername, getUserById, getUserByIdFull,
  setPublicKey, setMessagePrivacy, setReadReceipts, isFollowing,
};

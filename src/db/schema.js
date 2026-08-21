const { db } = require('./client');

/**
 * جميع الجداول اللازمة لنظام المراسلات (خاص + مجموعات) بما فيها:
 * التفاعلات، الحذف/التعديل، إشعارات القراءة، الكنية الخاصة، مؤشر الكتابة،
 * التشفير من طرف لطرف مع نسخة PIN احتياطية، الحظر، وخصوصية المراسلة.
 *
 * جدول users هنا مبسّط (فقط ما يحتاجه نظام المراسلات + مصادقة أساسية).
 * لو بدك تدمجه بمشروع أكبر فيه users كامل، احذف تعريف users من هنا
 * وخلي باقي الجداول تشير لجدول users الموجود عندك (المفاتيح الأجنبية نفسها).
 */
async function initSchema() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      password      TEXT NOT NULL,
      display_name  TEXT DEFAULT '',
      avatar        TEXT DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'user',
      public_key    TEXT DEFAULT '',
      message_privacy TEXT NOT NULL DEFAULT 'everyone',  -- everyone | followers | none
      read_receipts INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS follows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(follower_id, followed_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, blocked_id)
    );

    -- ===== رسائل خاصة (1 لـ 1) =====
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_name  TEXT NOT NULL,
      to_name    TEXT NOT NULL,
      content    TEXT NOT NULL,
      image      TEXT DEFAULT '',
      reply_to   INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL,
      encrypted  INTEGER NOT NULL DEFAULT 0,
      iv         TEXT DEFAULT '',
      read       INTEGER NOT NULL DEFAULT 0,
      edited     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_id, to_id, created_at);

    CREATE TABLE IF NOT EXISTS message_reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL DEFAULT 'heart',
      UNIQUE(message_id, user_id)
    );

    -- كنية خاصة: أنا أرى اسم مستخدم آخر بشكل مختلف بمحادثتي فقط
    CREATE TABLE IF NOT EXISTS dm_nicknames (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname   TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, target_id)
    );

    -- مؤشر "يكتب..." — chat_key موحّد للدردشة الفردية والجماعية
    CREATE TABLE IF NOT EXISTS typing_status (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key   TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chat_key, user_id)
    );

    -- ===== مجموعات =====
    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatar      TEXT DEFAULT '',
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname  TEXT DEFAULT '',
      role      TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
      last_read_at TEXT DEFAULT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_name   TEXT NOT NULL,
      from_avatar TEXT DEFAULT '',
      content     TEXT NOT NULL,
      image       TEXT DEFAULT '',
      edited      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);

    CREATE TABLE IF NOT EXISTS group_message_reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL DEFAULT 'heart',
      UNIQUE(message_id, user_id)
    );

    -- ===== نسخة PIN احتياطية لمفتاح التشفير (E2EE) =====
    -- السيرفر لا يرى أبداً المفتاح الخاص أو رمز الـ PIN بصيغة قابلة للقراءة.
    CREATE TABLE IF NOT EXISTS key_backups (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      salt            TEXT NOT NULL,
      iv              TEXT NOT NULL,
      wrapped_key     TEXT NOT NULL,
      verifier        TEXT NOT NULL,
      iterations      INTEGER NOT NULL DEFAULT 600000,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    TEXT DEFAULT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('✅ Schema ready');
}

module.exports = { initSchema };

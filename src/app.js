const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initSchema } = require('./db/schema');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const messagesRoutes = require('./routes/messages.routes');
const groupsRoutes = require('./routes/groups.routes');
const keysRoutes = require('./routes/keys.routes');
const typingRoutes = require('./routes/typing.routes');
const settingsRoutes = require('./routes/settings.routes');
const usersRoutes = require('./routes/users.routes');
const uploadRoutes = require('./routes/upload.routes');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/typing', typingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/upload', uploadRoutes);

// 404 لأي مسار API غير معروف
app.use('/api', (req, res) => res.status(404).json({ error: 'مسار غير موجود' }));

app.use(errorHandler);

/**
 * تهيئة الجداول مرة واحدة فقط لكل عملية (process) — نخزّن الـ Promise ونعيد
 * استخدامه، بدل ما نشغّل initSchema() من جديد بكل طلب. هذا مهم بالذات على
 * Vercel: كل "cold start" يشغّل هذا الملف من الصفر، فلازم نتأكد أن أول طلب
 * بهيك cold start ينتظر جهوزية القاعدة قبل ما يكمل.
 */
let schemaReadyPromise = null;
function ensureSchemaReady() {
  if (!schemaReadyPromise) schemaReadyPromise = initSchema();
  return schemaReadyPromise;
}

module.exports = { app, ensureSchemaReady };

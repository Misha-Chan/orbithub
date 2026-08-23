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
const reportsRoutes = require('./routes/reports.routes');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * بوابة /chat على hostaka.fun تحوّل المستخدم لـ
 * https://orbithub.hostaka.fun/chat?token=... (راجع sendSubdomainRedirect
 * بمشروع hostaka-main) — يعني /chat (بدون .html) لازم يكون مسار حقيقي
 * هنا، مو بس اسم ملف. express.static وحده ما يعرف يوصّل /chat لـ
 * chat.html (هو يبحث عن ملف اسمه "chat" بالضبط، وما يلاقيه، فيرجّع 404).
 * هذا كان سبب الـ 404 اللي كان يطلع بعد التحويل من Hostaka.
 */
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
});

// أي رابط قديم لجذر الموقع يوديه لنفس صفحة الدردشة (لا يوجد صفحة هبوط
// منفصلة بـ orbithub — هو فرع مراسلات فقط).
app.get('/', (req, res) => res.redirect('/chat'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/typing', typingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportsRoutes);

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

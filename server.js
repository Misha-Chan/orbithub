require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initSchema } = require('./src/db/schema');
const { errorHandler } = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth.routes');
const messagesRoutes = require('./src/routes/messages.routes');
const groupsRoutes = require('./src/routes/groups.routes');
const keysRoutes = require('./src/routes/keys.routes');
const typingRoutes = require('./src/routes/typing.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const usersRoutes = require('./src/routes/users.routes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/typing', typingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);

// 404 لأي مسار API غير معروف
app.use('/api', (req, res) => res.status(404).json({ error: 'مسار غير موجود' }));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Messaging system running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database schema:', err);
    process.exit(1);
  });

module.exports = app;

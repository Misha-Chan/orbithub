require('dotenv').config();
const { app, ensureSchemaReady } = require('./src/app');

// نقطة التشغيل المحلية (npm start) — على Vercel ما يستخدم هذا الملف إطلاقاً،
// يستخدم api/index.js بدلاً منه (راجع vercel.json).
const PORT = process.env.PORT || 3000;

ensureSchemaReady()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Messaging system running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database schema:', err);
    process.exit(1);
  });

module.exports = app;

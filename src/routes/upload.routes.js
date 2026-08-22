const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * رفع صور فعلي عبر ImgBB — نفس آلية Hostaka بالضبط (/api/upload) ونفس
 * مفتاح IMGBB_API_KEY، لأن orbithub فرع تابع لها. الواجهة الأمامية ترسل
 * الصورة كـ base64 (بعد اختيارها من زر "إرفاق صورة" الحقيقي)، والسيرفر
 * يرفعها لـ ImgBB ويرجّع رابطها ليُخزَّن كـ image بالرسالة — تماماً متل
 * Hostaka، بدون أي تخزين محلي على orbithub نفسه.
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'لا توجد صورة' });

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'IMGBB_API_KEY غير مُعدّ' });

  const base64 = image.includes(',') ? image.split(',')[1] : image;
  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('image', base64);

  try {
    const r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const data = await r.json();
    if (!data.success) return res.status(500).json({ error: 'فشل الرفع' });
    res.json({ url: data.data.url });
  } catch (e) {
    console.error('❌ Image upload error:', e);
    res.status(500).json({ error: 'تعذر رفع الصورة' });
  }
}));

module.exports = router;

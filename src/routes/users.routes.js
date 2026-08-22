const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const users = require('../services/users.service');

const router = express.Router();
router.use(requireAuth);

router.get('/:username', asyncHandler(async (req, res) => {
  const u = await users.getUserByUsername(req.params.username);
  if (!u) throw new ApiError(404, 'غير موجود');
  res.json({
    id: u.id, username: u.username, display_name: u.display_name,
    avatar: u.avatar, message_privacy: u.message_privacy,
  });
}));

module.exports = router;

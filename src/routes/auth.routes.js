const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireFields, ApiError } = require('../utils/validate');
const users = require('../services/users.service');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password, displayName } = req.body || {};
  requireFields(req.body, ['username', 'email', 'password']);
  if (password.length < 8) throw new ApiError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');

  if (await users.getUserByEmail(email)) throw new ApiError(409, 'البريد مستخدم مسبقاً');
  if (await users.getUserByUsername(username)) throw new ApiError(409, 'اسم المستخدم مستخدم مسبقاً');

  const passwordHash = bcrypt.hashSync(password, 10);
  const id = await users.createUser({ username, email, passwordHash, displayName });
  const user = await users.getUserById(id);
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  requireFields(req.body, ['email', 'password']);

  const dbUser = await users.getUserByEmail(email);
  if (!dbUser || !bcrypt.compareSync(password, dbUser.password)) {
    throw new ApiError(401, 'البريد أو كلمة المرور غير صحيحة');
  }
  const user = await users.getUserById(dbUser.id);
  res.json({ token: signToken(user), user });
}));

module.exports = router;

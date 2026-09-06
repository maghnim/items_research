const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password, fullName, phone } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and password (8+ chars) required.' });
  }
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.query(
    `INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, phone, plan_tier, plan_status`,
    [email.toLowerCase(), passwordHash, fullName.trim(), phone ? phone.trim() : null]
  );

  const user = result.rows[0];
  const token = signToken(user.id);
  res.status(201).json({ token, user });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }

  const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, phone: user.phone, plan_tier: user.plan_tier, plan_status: user.plan_status, trial_expires_at: user.trial_expires_at },
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT id, email, full_name, phone, plan_tier, plan_status, trial_expires_at, created_at FROM users WHERE id = $1',
    [req.userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ user: result.rows[0] });
}));

module.exports = router;

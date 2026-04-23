const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const normalizedEmail = email.toLowerCase().trim();
  const password_hash = await bcrypt.hash(password, 10);

  try {
    const { rows } = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${normalizedEmail}, ${password_hash})
      RETURNING id, email, status, is_admin, created_at
    `;
    const user = rows[0];
    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    return res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error('register error:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }
};

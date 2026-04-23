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

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { rows } = await sql`
      SELECT id, email, password_hash, status, is_admin, created_at
      FROM users WHERE email = ${normalizedEmail}
    `;
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safeUser } = user;
    return res.status(200).json({ token, user: safeUser });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};

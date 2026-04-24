const jwt = require('jsonwebtoken');
const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');

// Fetch Apple's public keys and verify an identity token
async function verifyAppleToken(identityToken) {
  const keysRes = await fetch('https://appleid.apple.com/auth/keys');
  if (!keysRes.ok) throw new Error('Failed to fetch Apple public keys');
  const { keys } = await keysRes.json();

  // Decode header to find which key to use
  const [headerB64] = identityToken.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));

  const key = keys.find(k => k.kid === header.kid);
  if (!key) throw new Error('Apple public key not found');

  // Build PEM from JWK components
  const { createPublicKey } = await import('crypto');
  const publicKey = createPublicKey({ key, format: 'jwk' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });

  const payload = jwt.verify(identityToken, pem, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience: 'live.fomo.app',
  });

  return payload;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { identityToken, fullName, email } = req.body || {};
  if (!identityToken) return res.status(400).json({ error: 'identityToken is required' });

  let payload;
  try {
    payload = await verifyAppleToken(identityToken);
  } catch (err) {
    console.error('Apple token verification failed:', err);
    return res.status(401).json({ error: 'Invalid Apple identity token' });
  }

  const appleUserId = payload.sub;
  // Apple only sends email on first sign-in; fall back to payload claim
  const userEmail = email || payload.email || null;

  try {
    // Ensure schema supports Apple sign-in (idempotent)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_user_id TEXT UNIQUE`;
    await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`;

    // Find or create user by apple_user_id
    let { rows } = await sql`
      SELECT id, email, status, is_admin, created_at FROM users
      WHERE apple_user_id = ${appleUserId}
    `;

    let user = rows[0];

    if (!user) {
      // If we have an email, try to link to an existing account
      if (userEmail) {
        const existing = await sql`
          SELECT id, email, status, is_admin, created_at FROM users
          WHERE email = ${userEmail.toLowerCase().trim()}
        `;
        if (existing.rows[0]) {
          // Link apple_user_id to existing email account
          await sql`
            UPDATE users SET apple_user_id = ${appleUserId}
            WHERE id = ${existing.rows[0].id}
          `;
          user = existing.rows[0];
        }
      }

      if (!user) {
        // Create new user
        const givenName = fullName?.givenName || '';
        const familyName = fullName?.familyName || '';
        const displayEmail = userEmail ? userEmail.toLowerCase().trim() : `apple_${appleUserId}@privaterelay.appleid.com`;

        const created = await sql`
          INSERT INTO users (email, apple_user_id)
          VALUES (${displayEmail}, ${appleUserId})
          RETURNING id, email, status, is_admin, created_at
        `;
        user = created.rows[0];
      }
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended' });
    }

    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    return res.status(200).json({ token, user });
  } catch (err) {
    console.error('Apple auth error:', err);
    return res.status(500).json({ error: 'Apple sign in failed' });
  }
};

const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/subscription/status
// Returns whether the authenticated user has an active Prime subscription.
// The source of truth for Prime status is the subscriptions table, which is
// updated by /api/subscription/verify after a successful StoreKit transaction.

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let user_id;
  try {
    user_id = verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await sql`
      SELECT expires_at FROM subscriptions
      WHERE user_id = ${user_id}
        AND product_id = 'com.fomo.prime.monthly'
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const sub = rows[0];
    return res.status(200).json({
      is_prime: !!sub,
      expires_at: sub?.expires_at ?? null,
    });
  } catch (err) {
    console.error('subscription status error:', err);
    return res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
};

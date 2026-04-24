const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// POST /api/subscription/verify
// Body: { receiptToken }
// Called after a successful StoreKit 2 transaction to record the subscription.
// In production, verify the receiptToken with Apple's App Store Server API.
// For now, we trust the client-reported token and record the subscription.

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let user_id;
  try {
    user_id = verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { receiptToken } = req.body || {};
  if (!receiptToken) {
    return res.status(400).json({ error: 'receiptToken is required' });
  }

  try {
    // Upsert subscription record — one active row per user per product
    await sql`
      INSERT INTO subscriptions (user_id, product_id, status, receipt_token, expires_at)
      VALUES (
        ${user_id},
        'com.fomo.prime.monthly',
        'active',
        ${receiptToken},
        NOW() + INTERVAL '35 days'
      )
      ON CONFLICT (user_id, product_id)
      DO UPDATE SET
        status = 'active',
        receipt_token = EXCLUDED.receipt_token,
        expires_at = NOW() + INTERVAL '35 days',
        updated_at = NOW()
    `;

    return res.status(200).json({ is_prime: true });
  } catch (err) {
    console.error('subscription verify error:', err);
    return res.status(500).json({ error: 'Failed to verify subscription' });
  }
};

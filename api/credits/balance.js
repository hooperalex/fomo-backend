const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/credits/balance
// Per spec (04-credit-economy): balance is derived from ledger. Append-only ledger.
// available + reserved = total

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
      SELECT
        COALESCE(SUM(CASE
          WHEN type IN ('topup', 'bonus', 'refund', 'subscription_issue', 'release') THEN amount
          WHEN type IN ('reserve', 'capture') THEN -amount
          ELSE 0
        END) FILTER (WHERE status = 'posted' AND (expires_at IS NULL OR expires_at > NOW())), 0) AS available,

        COALESCE(SUM(amount) FILTER (
          WHERE type = 'reserve' AND status = 'posted'
        ), 0) AS reserved,

        COALESCE(SUM(amount) FILTER (
          WHERE type IN ('topup', 'subscription_issue', 'bonus') AND status = 'posted'
        ), 0) AS lifetime_credited,

        COALESCE(SUM(amount) FILTER (
          WHERE type = 'capture' AND status = 'posted'
        ), 0) AS lifetime_spent
      FROM credit_transactions
      WHERE user_id = ${user_id}
    `;

    const row = rows[0];
    return res.status(200).json({
      balance: {
        available: Math.max(0, parseFloat(row.available)),
        reserved: parseFloat(row.reserved),
        lifetimeCredited: parseFloat(row.lifetime_credited),
        lifetimeSpent: parseFloat(row.lifetime_spent),
      },
    });
  } catch (err) {
    console.error('balance error:', err);
    return res.status(500).json({ error: 'Failed to fetch balance' });
  }
};

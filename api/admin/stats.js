const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/admin/stats — platform stats for admin dashboard

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

  const userCheck = await sql`SELECT is_admin FROM users WHERE id = ${user_id}`;
  if (!userCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  try {
    const [users, auctions, bids, revenue] = await Promise.all([
      sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d
        FROM users WHERE status = 'active'
      `,
      sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'live') AS live,
          COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
          COUNT(*) FILTER (WHERE status = 'sold') AS sold,
          COUNT(*) FILTER (WHERE status = 'expired') AS expired
        FROM auctions
      `,
      sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE actor = 'human' AND status = 'accepted') AS human_accepted,
          COUNT(*) FILTER (WHERE actor = 'agent') AS agent_total
        FROM bids
      `,
      sql`
        SELECT
          COALESCE(SUM(amount), 0) AS total_credits_sold,
          COALESCE(SUM(amount) FILTER (WHERE type = 'capture'), 0) AS total_credits_spent
        FROM credit_transactions
        WHERE status = 'posted' AND type IN ('topup', 'capture')
      `,
    ]);

    return res.status(200).json({
      stats: {
        users: users.rows[0],
        auctions: auctions.rows[0],
        bids: bids.rows[0],
        revenue: revenue.rows[0],
      },
    });
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

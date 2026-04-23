const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/auctions/history — completed auctions the user bid on or won
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

  const { limit = '20', offset = '0' } = req.query;

  try {
    const { rows } = await sql`
      SELECT DISTINCT
        a.id, a.status, a.start_price, a.floor_price, a.starts_at, a.ends_at,
        a.winning_bid_id,
        p.id AS product_id, p.title, p.brand, p.images, p.category,
        (a.winning_bid_id IN (
          SELECT id FROM bids WHERE user_id = ${user_id}
        )) AS user_won,
        (SELECT amount FROM bids WHERE id = a.winning_bid_id) AS winning_price
      FROM auctions a
      JOIN products p ON p.id = a.product_id
      JOIN bids b ON b.auction_id = a.id
      WHERE b.user_id = ${user_id}
        AND b.actor = 'human'
        AND a.status IN ('sold', 'expired', 'cancelled')
      ORDER BY a.ends_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;

    return res.status(200).json({ history: rows });
  } catch (err) {
    console.error('auction history error:', err);
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
};

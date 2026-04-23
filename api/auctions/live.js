const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');
const { auctionSnapshot } = require('../../lib/auction');

// GET /api/auctions/live — ranked feed of live and upcoming auctions
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { rows } = await sql`
      SELECT
        a.id, a.product_id, a.start_price, a.floor_price, a.duration_seconds,
        a.jitter_seconds, a.status, a.starts_at, a.ends_at, a.winning_bid_id,
        p.title, p.brand, p.category, p.subcategory, p.images, p.tags,
        p.condition, p.size_options, p.rating, p.rating_count,
        (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id AND b.actor = 'human' AND b.status != 'expired') AS bid_count
      FROM auctions a
      JOIN products p ON p.id = a.product_id
      WHERE a.status IN ('live', 'scheduled')
      ORDER BY
        CASE a.status WHEN 'live' THEN 0 ELSE 1 END,
        a.starts_at ASC
      LIMIT 50
    `;

    const drops = rows.map(row => ({
      ...auctionSnapshot(row),
      product: {
        id: row.product_id,
        title: row.title,
        brand: row.brand,
        category: row.category,
        subcategory: row.subcategory,
        images: row.images,
        tags: row.tags,
        condition: row.condition,
        sizeOptions: row.size_options,
        rating: row.rating,
        ratingCount: row.rating_count,
      },
      bidCount: parseInt(row.bid_count),
    }));

    return res.status(200).json({ drops });
  } catch (err) {
    console.error('live feed error:', err);
    return res.status(500).json({ error: 'Failed to fetch live drops' });
  }
};

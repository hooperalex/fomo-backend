const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');
const { auctionSnapshot } = require('../../lib/auction');

// GET /api/auctions/:id — full auction state snapshot with product
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;

  try {
    const { rows } = await sql`
      SELECT
        a.id, a.product_id, a.start_price, a.floor_price, a.duration_seconds,
        a.jitter_seconds, a.status, a.starts_at, a.ends_at, a.winning_bid_id,
        p.id AS pid, p.title, p.description, p.brand, p.category, p.subcategory,
        p.images, p.tags, p.condition, p.size_options, p.rating, p.rating_count,
        p.retail_price, p.floor_price AS product_floor,
        (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id AND b.actor = 'human' AND b.status != 'expired') AS bid_count
      FROM auctions a
      JOIN products p ON p.id = a.product_id
      WHERE a.id = ${id}
    `;
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });

    const row = rows[0];
    const snapshot = auctionSnapshot(row);

    return res.status(200).json({
      auction: {
        ...snapshot,
        product: {
          id: row.pid,
          title: row.title,
          description: row.description,
          brand: row.brand,
          category: row.category,
          subcategory: row.subcategory,
          images: row.images,
          tags: row.tags,
          condition: row.condition,
          sizeOptions: row.size_options,
          rating: row.rating,
          ratingCount: row.rating_count,
          retailPrice: parseFloat(row.retail_price),
        },
        bidCount: parseInt(row.bid_count),
      },
    });
  } catch (err) {
    console.error('auction detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch auction' });
  }
};

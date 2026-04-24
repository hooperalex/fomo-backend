const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');
const { auctionSnapshot } = require('../../lib/auction');

// GET /api/auctions/personalized
// Returns live and upcoming auctions ranked by the user's interest profile.
// Falls back to chronological order when no profile exists.
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
    // Fetch interest profile (implicit behavioral weights)
    const profileResult = await sql`
      SELECT category_weights FROM user_interest_profiles WHERE user_id = ${user_id}
    `;
    const categoryWeights = profileResult.rows[0]?.category_weights ?? {};

    // Fetch live and scheduled auctions
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

    // Score and rank by interest profile
    // Live auctions always precede scheduled; within each group, sort by weight desc then starts_at asc
    const scored = rows.map(row => {
      const weight = categoryWeights[row.category] ?? 0;
      return { row, weight };
    });

    const live      = scored.filter(x => x.row.status === 'live');
    const scheduled = scored.filter(x => x.row.status !== 'live');

    const rank = (a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return new Date(a.row.starts_at) - new Date(b.row.starts_at);
    };

    live.sort(rank);
    scheduled.sort(rank);

    const drops = [...live, ...scheduled].map(({ row }) => ({
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
      interestScore: categoryWeights[row.category] ?? 0,
    }));

    return res.status(200).json({ drops, hasProfile: Object.keys(categoryWeights).length > 0 });
  } catch (err) {
    console.error('personalized feed error:', err);
    return res.status(500).json({ error: 'Failed to fetch personalized feed' });
  }
};

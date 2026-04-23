const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// POST /api/admin/create-auction — admin only
// Per spec (03-auction-mechanics): 30s window, ±3s jitter applied at schedule time.
// Jitter is random; clients never know the exact end time (anti-sniping).

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

  const userCheck = await sql`SELECT is_admin FROM users WHERE id = ${user_id}`;
  if (!userCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  const {
    productId,
    startPrice,
    floorPrice,
    startsAt,
    durationSeconds = 30,
    jitterSeconds = 3,
  } = req.body || {};

  if (!productId || !startPrice || !floorPrice || !startsAt) {
    return res.status(400).json({ error: 'productId, startPrice, floorPrice, startsAt are required' });
  }
  if (parseFloat(floorPrice) >= parseFloat(startPrice)) {
    return res.status(400).json({ error: 'floorPrice must be less than startPrice' });
  }

  const startTs = new Date(startsAt);
  if (isNaN(startTs.getTime())) return res.status(400).json({ error: 'Invalid startsAt timestamp' });
  if (startTs <= new Date()) return res.status(400).json({ error: 'startsAt must be in the future' });

  // Verify product exists and is in stock
  const productCheck = await sql`
    SELECT id, stock_status FROM products WHERE id = ${productId} AND is_active = TRUE
  `;
  if (!productCheck.rows[0]) return res.status(404).json({ error: 'Product not found or inactive' });
  if (productCheck.rows[0].stock_status !== 'in_stock') {
    return res.status(422).json({ error: 'Product is out of stock' });
  }

  // Apply jitter: random offset in [-jitter, +jitter] seconds
  const jitter = jitterSeconds;
  const jitterMs = (Math.random() * 2 * jitter - jitter) * 1000;
  const effectiveStart = new Date(startTs.getTime() + jitterMs);
  const effectiveEnd = new Date(effectiveStart.getTime() + durationSeconds * 1000);

  try {
    const { rows } = await sql`
      INSERT INTO auctions (
        product_id, start_price, floor_price, duration_seconds, jitter_seconds,
        starts_at, ends_at, created_by
      )
      VALUES (
        ${productId}, ${parseFloat(startPrice)}, ${parseFloat(floorPrice)},
        ${durationSeconds}, ${jitter},
        ${effectiveStart.toISOString()}, ${effectiveEnd.toISOString()},
        ${user_id}
      )
      RETURNING *
    `;
    return res.status(201).json({ auction: rows[0] });
  } catch (err) {
    console.error('create auction error:', err);
    return res.status(500).json({ error: 'Failed to create auction' });
  }
};

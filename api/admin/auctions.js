const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');
const { auctionSnapshot } = require('../../lib/auction');

// GET /api/admin/auctions — list all auctions with product info
// POST /api/admin/auctions (with action=pause|resume|cancel in body) — control auction state

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  let user_id;
  try {
    user_id = verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userCheck = await sql`SELECT is_admin FROM users WHERE id = ${user_id}`;
  if (!userCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  if (req.method === 'GET') {
    const { status, limit = '50', offset = '0' } = req.query;
    try {
      let rows;
      if (status) {
        ({ rows } = await sql`
          SELECT a.*, p.title AS product_title, p.sku
          FROM auctions a JOIN products p ON p.id = a.product_id
          WHERE a.status = ${status}
          ORDER BY a.starts_at DESC
          LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `);
      } else {
        ({ rows } = await sql`
          SELECT a.*, p.title AS product_title, p.sku
          FROM auctions a JOIN products p ON p.id = a.product_id
          ORDER BY a.starts_at DESC
          LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `);
      }
      return res.status(200).json({ auctions: rows.map(r => ({ ...auctionSnapshot(r), productTitle: r.product_title, sku: r.sku })) });
    } catch (err) {
      console.error('admin auctions error:', err);
      return res.status(500).json({ error: 'Failed to fetch auctions' });
    }
  }

  if (req.method === 'POST') {
    const { auctionId, action, reason } = req.body || {};
    if (!auctionId || !action) return res.status(400).json({ error: 'auctionId and action required' });
    if (!['pause', 'resume', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'action must be pause, resume, or cancel' });
    }

    try {
      if (action === 'pause') {
        const { rows } = await sql`
          UPDATE auctions
          SET status = 'cancelled', paused_at = NOW(), paused_by = ${user_id}, pause_reason = ${reason || null}, updated_at = NOW()
          WHERE id = ${auctionId} AND status = 'live'
          RETURNING id, status
        `;
        if (!rows[0]) return res.status(422).json({ error: 'Auction is not live' });
        return res.status(200).json({ auction: rows[0] });
      }
      if (action === 'cancel') {
        const { rows } = await sql`
          UPDATE auctions
          SET status = 'cancelled', cancel_reason = ${reason || null}, updated_at = NOW()
          WHERE id = ${auctionId} AND status IN ('scheduled', 'live', 'winning_hold')
          RETURNING id, status
        `;
        if (!rows[0]) return res.status(422).json({ error: 'Auction cannot be cancelled in its current state' });
        // Release any pending reserves
        await sql`
          UPDATE bids SET status = 'expired'
          WHERE auction_id = ${auctionId} AND status = 'pending'
        `;
        return res.status(200).json({ auction: rows[0] });
      }
    } catch (err) {
      console.error('admin auction action error:', err);
      return res.status(500).json({ error: 'Action failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

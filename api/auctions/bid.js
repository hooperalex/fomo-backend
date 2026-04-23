const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');
const { currentPrice, auctionStatus } = require('../../lib/auction');

// POST /api/auctions/bid
// Body: { auctionId, amount, idempotencyKey, selectedSize? }
//
// Spec rules (03-auction-mechanics, 04-credit-economy, 16-realtime-bidding):
// - Server-authoritative state; reject if auction not live
// - First valid actor=human bid at or above currentPrice wins
// - Idempotent by idempotencyKey — repeated submissions return prior outcome
// - Reserve credits before accepting; capture on win (via separate flow)
// - Agents never win; winner must have actor=human
// - One active reserve per user per auction

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

  const { auctionId, amount, idempotencyKey, selectedSize } = req.body || {};
  if (!auctionId || amount == null || !idempotencyKey) {
    return res.status(400).json({ error: 'auctionId, amount, and idempotencyKey are required' });
  }

  const bidAmount = parseFloat(amount);
  if (isNaN(bidAmount) || bidAmount <= 0) {
    return res.status(400).json({ error: 'Invalid bid amount' });
  }

  try {
    // Idempotency check — return prior outcome immediately
    const existing = await sql`
      SELECT id, status, reject_reason FROM bids WHERE idempotency_key = ${idempotencyKey}
    `;
    if (existing.rows[0]) {
      const bid = existing.rows[0];
      return res.status(200).json({
        bid: { id: bid.id, status: bid.status, rejectReason: bid.reject_reason },
        idempotent: true,
      });
    }

    // Verify user is active
    const userCheck = await sql`SELECT status FROM users WHERE id = ${user_id}`;
    if (!userCheck.rows[0] || userCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Account not eligible to bid' });
    }

    // Fetch auction
    const auctionResult = await sql`
      SELECT id, start_price, floor_price, duration_seconds, status, starts_at, ends_at, winning_bid_id
      FROM auctions WHERE id = ${auctionId}
    `;
    if (!auctionResult.rows[0]) return res.status(404).json({ error: 'Auction not found' });

    const auction = auctionResult.rows[0];
    const status = auctionStatus(auction);

    if (status !== 'live') {
      const { rows: [bidRow] } = await sql`
        INSERT INTO bids (auction_id, user_id, actor, amount, idempotency_key, status, reject_reason)
        VALUES (${auctionId}, ${user_id}, 'human', ${bidAmount}, ${idempotencyKey}, 'rejected', ${
          status === 'scheduled' ? 'auction_not_started' :
          status === 'expired' ? 'bid_too_late' :
          status === 'sold' ? 'auction_sold' :
          'auction_not_live'
        })
        RETURNING id, status, reject_reason
      `;
      return res.status(422).json({
        error: 'Auction is not live',
        bid: { id: bidRow.id, status: bidRow.status, rejectReason: bidRow.reject_reason },
      });
    }

    // Compute current price (server-authoritative)
    const now = Date.now();
    const elapsed = (now - new Date(auction.starts_at).getTime()) / 1000;
    const price = currentPrice(
      parseFloat(auction.start_price),
      parseFloat(auction.floor_price),
      auction.duration_seconds,
      elapsed
    );

    if (bidAmount < price) {
      const { rows: [bidRow] } = await sql`
        INSERT INTO bids (auction_id, user_id, actor, amount, idempotency_key, status, reject_reason)
        VALUES (${auctionId}, ${user_id}, 'human', ${bidAmount}, ${idempotencyKey}, 'rejected', 'bid_below_current_price')
        RETURNING id, status, reject_reason
      `;
      return res.status(422).json({
        error: 'Bid below current price',
        currentPrice: price,
        bid: { id: bidRow.id, status: bidRow.status, rejectReason: bidRow.reject_reason },
      });
    }

    // Check credit balance — derived from ledger
    const balanceResult = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('topup','bonus','refund','subscription_issue') THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type IN ('reserve','capture') THEN amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN type IN ('release') THEN amount ELSE 0 END), 0)
        AS available
      FROM credit_transactions
      WHERE user_id = ${user_id} AND status = 'posted'
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const available = parseFloat(balanceResult.rows[0]?.available || 0);
    if (available < bidAmount) {
      return res.status(422).json({ error: 'Insufficient credits', available, required: bidAmount });
    }

    // Check for concurrent reserve on this auction
    const concurrentCheck = await sql`
      SELECT id FROM bids
      WHERE user_id = ${user_id} AND auction_id = ${auctionId}
        AND status = 'pending' AND actor = 'human'
    `;
    if (concurrentCheck.rows.length > 0) {
      return res.status(409).json({ error: 'concurrent_bid_in_flight' });
    }

    // Reserve credits (debit from available)
    await sql`
      INSERT INTO credit_transactions (user_id, type, amount, source_id, auction_id, memo)
      VALUES (${user_id}, 'reserve', ${-bidAmount}, ${idempotencyKey}, ${auctionId}, 'Bid reserve')
    `;

    // Re-check auction still live (re-fetch to race-guard)
    const freshAuction = await sql`
      SELECT status, starts_at, ends_at, winning_bid_id FROM auctions WHERE id = ${auctionId}
    `;
    const freshStatus = auctionStatus(freshAuction.rows[0]);

    if (freshStatus !== 'live') {
      // Release reserve — auction closed between our check and now
      await sql`
        INSERT INTO credit_transactions (user_id, type, amount, source_id, auction_id, memo)
        VALUES (${user_id}, 'release', ${bidAmount}, ${idempotencyKey}, ${auctionId}, 'Release — auction closed')
      `;
      return res.status(422).json({ error: 'Auction closed', code: 'bid_too_late' });
    }

    // Insert accepted bid
    const { rows: [bidRow] } = await sql`
      INSERT INTO bids (auction_id, user_id, actor, amount, idempotency_key, status)
      VALUES (${auctionId}, ${user_id}, 'human', ${bidAmount}, ${idempotencyKey}, 'accepted')
      RETURNING id, status, amount, created_at
    `;

    // Mark auction as winning_hold and record winning bid
    await sql`
      UPDATE auctions SET status = 'winning_hold', winning_bid_id = ${bidRow.id}, updated_at = NOW()
      WHERE id = ${auctionId} AND status = 'live'
    `;

    // Expire all other pending bids on this auction and release their reserves
    const otherBids = await sql`
      UPDATE bids SET status = 'expired'
      WHERE auction_id = ${auctionId} AND id != ${bidRow.id} AND status = 'pending' AND actor = 'human'
      RETURNING id, user_id, amount, idempotency_key
    `;
    for (const loser of otherBids.rows) {
      await sql`
        INSERT INTO credit_transactions (user_id, type, amount, source_id, auction_id, memo)
        VALUES (${loser.user_id}, 'release', ${loser.amount}, ${loser.idempotency_key}, ${auctionId}, 'Release — outbid')
      `;
    }

    // Capture winning credits and mark auction sold
    await sql`
      INSERT INTO credit_transactions (user_id, type, amount, source_id, auction_id, memo)
      VALUES (${user_id}, 'capture', ${-bidAmount}, ${idempotencyKey}, ${auctionId}, 'Auction win capture')
    `;
    await sql`
      UPDATE auctions SET status = 'sold', updated_at = NOW()
      WHERE id = ${auctionId} AND status = 'winning_hold'
    `;

    return res.status(201).json({
      bid: { id: bidRow.id, status: 'accepted', amount: parseFloat(bidRow.amount), createdAt: bidRow.created_at },
      auction: { id: auctionId, status: 'sold' },
    });
  } catch (err) {
    console.error('bid error:', err);
    return res.status(500).json({ error: 'Bid submission failed' });
  }
};

const { sql } = require('../../lib/db');
const { auctionSnapshot } = require('../../lib/auction');

// GET /api/auctions/events?auctionId=<id>
// SSE endpoint — streams auction tick events (price, status, countdown) every second.
// Clients subscribe for the duration of an active auction.
// Per spec (19-caching-and-state, 16-realtime-bidding): server owns state; clients only render.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { auctionId } = req.query;
  if (!auctionId) return res.status(400).json({ error: 'auctionId is required' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  let interval;
  let lastStatus = null;

  async function tick() {
    try {
      const { rows } = await sql`
        SELECT id, start_price, floor_price, duration_seconds, status, starts_at, ends_at, winning_bid_id
        FROM auctions WHERE id = ${auctionId}
      `;
      if (!rows[0]) {
        send('error', { message: 'Auction not found' });
        clearInterval(interval);
        res.end();
        return;
      }

      const snapshot = auctionSnapshot(rows[0]);
      send('tick', snapshot);

      // Terminal states — stop streaming
      if (['sold', 'expired', 'cancelled'].includes(snapshot.status)) {
        if (snapshot.status !== lastStatus) {
          send(snapshot.status === 'sold' ? 'auction.sold' : 'auction.expired', snapshot);
        }
        clearInterval(interval);
        res.end();
        return;
      }

      if (snapshot.status !== lastStatus) {
        send('auction.live', snapshot);
        lastStatus = snapshot.status;
      }
    } catch (err) {
      send('error', { message: 'Failed to fetch auction state' });
      clearInterval(interval);
      res.end();
    }
  }

  // Send initial state immediately, then tick every second
  await tick();
  interval = setInterval(tick, 1000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });
};

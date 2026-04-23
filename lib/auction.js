/**
 * Auction price curve: linear decline from startPrice to floorPrice over durationSeconds.
 * Server-authoritative. Clients only render.
 */

function currentPrice(startPrice, floorPrice, durationSeconds, elapsedSeconds) {
  if (elapsedSeconds <= 0) return startPrice;
  if (elapsedSeconds >= durationSeconds) return floorPrice;
  const progress = elapsedSeconds / durationSeconds;
  const price = startPrice - (startPrice - floorPrice) * progress;
  return Math.max(Math.round(price * 100) / 100, floorPrice);
}

function auctionStatus(auction) {
  const now = Date.now();
  const startsAt = new Date(auction.starts_at).getTime();
  const endsAt = new Date(auction.ends_at).getTime();

  if (auction.status === 'cancelled') return 'cancelled';
  if (auction.status === 'sold') return 'sold';
  if (auction.status === 'winning_hold') return 'winning_hold';
  if (now < startsAt) return 'scheduled';
  if (now >= endsAt) return 'expired';
  return 'live';
}

function auctionSnapshot(auction) {
  const now = Date.now();
  const startsAt = new Date(auction.starts_at).getTime();
  const endsAt = new Date(auction.ends_at).getTime();
  const status = auctionStatus(auction);

  let elapsed = 0;
  let remaining = auction.duration_seconds;

  if (status === 'live') {
    elapsed = (now - startsAt) / 1000;
    remaining = Math.max(0, (endsAt - now) / 1000);
  } else if (status === 'expired' || status === 'sold') {
    elapsed = auction.duration_seconds;
    remaining = 0;
  }

  const price = currentPrice(
    parseFloat(auction.start_price),
    parseFloat(auction.floor_price),
    auction.duration_seconds,
    elapsed
  );

  return {
    id: auction.id,
    status,
    currentPrice: price,
    startPrice: parseFloat(auction.start_price),
    floorPrice: parseFloat(auction.floor_price),
    durationSeconds: auction.duration_seconds,
    remainingSeconds: Math.round(remaining),
    startsAt: auction.starts_at,
    endsAt: auction.ends_at,
    winningBidId: auction.winning_bid_id || null,
  };
}

module.exports = { currentPrice, auctionStatus, auctionSnapshot };

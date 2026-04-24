-- Auction win orders (paid via Apple Pay)
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  auction_id        UUID NOT NULL REFERENCES auctions(id),
  bid_id            UUID NOT NULL REFERENCES bids(id) UNIQUE,
  amount            NUMERIC(10, 2) NOT NULL,
  shipping_fee      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  apple_pay_token   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'paid', -- paid | shipped | delivered | refunded
  estimated_delivery TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_auction ON orders (auction_id);

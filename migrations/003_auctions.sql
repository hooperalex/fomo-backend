CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  start_price NUMERIC(10,2) NOT NULL,
  floor_price NUMERIC(10,2) NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 30,
  jitter_seconds INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'winning_hold', 'sold', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  winning_bid_id UUID,
  paused_at TIMESTAMPTZ,
  paused_by UUID REFERENCES users(id),
  pause_reason TEXT,
  cancel_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auctions_status ON auctions (status);
CREATE INDEX idx_auctions_starts_at ON auctions (starts_at);
CREATE INDEX idx_auctions_product_id ON auctions (product_id);

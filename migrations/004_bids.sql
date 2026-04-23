CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL DEFAULT 'human' CHECK (actor IN ('human', 'agent')),
  amount NUMERIC(10,2) NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_bids_idempotency ON bids (idempotency_key);
CREATE INDEX idx_bids_auction_id ON bids (auction_id, created_at);
CREATE INDEX idx_bids_user_id ON bids (user_id, created_at);
CREATE INDEX idx_bids_actor ON bids (actor);

-- Add FK from auctions.winning_bid_id now that bids table exists
ALTER TABLE auctions ADD CONSTRAINT fk_auctions_winning_bid
  FOREIGN KEY (winning_bid_id) REFERENCES bids(id);

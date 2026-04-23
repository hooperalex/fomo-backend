-- Credit balance view: derived from ledger. Never modify history.
-- availableCredits + reservedCredits = total balance

CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN (
    'topup', 'reserve', 'capture', 'release',
    'refund', 'bonus', 'adjustment', 'expiry',
    'subscription_issue', 'subscription_expiry'
  )),
  amount NUMERIC(10,2) NOT NULL, -- positive = credit, negative = debit
  currency TEXT NOT NULL DEFAULT 'USD',
  source_id TEXT,               -- Stripe PaymentIntent id, auction id, etc.
  auction_id UUID REFERENCES auctions(id),
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'reversed', 'failed')),
  memo TEXT,
  expires_at TIMESTAMPTZ,       -- for subscription and bonus credits
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_txn_user_id ON credit_transactions (user_id, created_at);
CREATE INDEX idx_credit_txn_source_id ON credit_transactions (source_id);
CREATE INDEX idx_credit_txn_auction_id ON credit_transactions (auction_id);
CREATE INDEX idx_credit_txn_type ON credit_transactions (type);

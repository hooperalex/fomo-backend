-- FOMO Prime subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL,                    -- 'com.fomo.prime.monthly'
  status        TEXT NOT NULL DEFAULT 'active',   -- active | cancelled | expired
  receipt_token TEXT,                             -- StoreKit 2 transaction token
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
  ON subscriptions (user_id, status, expires_at);

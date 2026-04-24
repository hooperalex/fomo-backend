-- Track every user interaction with a product
CREATE TABLE IF NOT EXISTS user_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('view', 'skip', 'detail_open', 'bid', 'purchase')),
  duration_seconds INTEGER,
  price_at_action  NUMERIC(10,2),
  category         TEXT, -- denormalized from products.category for fast aggregation
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user     ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_category ON user_interactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_interactions_created  ON user_interactions(created_at);

-- Aggregated interest profile per user (updated on each interaction)
CREATE TABLE IF NOT EXISTS user_interest_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id),
  -- Weight per category (0.0 to 1.0, higher = more interested)
  -- e.g. {"Watches & Wearables": 0.85, "Audio & Speakers": 0.6, "Gaming": 0.3}
  category_weights   JSONB DEFAULT '{}',
  total_interactions INTEGER DEFAULT 0,
  total_purchases    INTEGER DEFAULT 0,
  last_updated       TIMESTAMPTZ DEFAULT NOW()
);

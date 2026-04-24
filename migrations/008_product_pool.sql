-- Track which products have been used in auctions (to maintain a ready pool)
ALTER TABLE products ADD COLUMN IF NOT EXISTS used_in_auction BOOLEAN NOT NULL DEFAULT false;

-- CJ metadata for personalization and filtering
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_location TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cj_category_id TEXT;

-- Mark products already associated with any auction as used
UPDATE products SET used_in_auction = true
WHERE id IN (
  SELECT DISTINCT product_id FROM auctions
  WHERE status IN ('live', 'scheduled', 'winning_hold', 'sold')
);

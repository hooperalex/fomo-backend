const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// POST /api/admin/create-product — admin only
// Valid categories per spec (24-category-taxonomy)
const VALID_CATEGORIES = [
  'phones_and_accessories', 'audio', 'home_lighting', 'desk_gear',
  'kids', 'fitness', 'gaming', 'wearables',
];

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

  // Verify admin role
  const userCheck = await sql`SELECT is_admin FROM users WHERE id = ${user_id}`;
  if (!userCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  const {
    title, description, brand, category, subcategory, tags,
    condition = 'new', images, sku, retail_price, floor_price,
    size_options,
  } = req.body || {};

  if (!title || !category || !sku || !retail_price || !floor_price) {
    return res.status(400).json({ error: 'title, category, sku, retail_price, floor_price are required' });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  if (parseFloat(floor_price) >= parseFloat(retail_price)) {
    return res.status(400).json({ error: 'floor_price must be less than retail_price' });
  }

  try {
    const { rows } = await sql`
      INSERT INTO products (
        title, description, brand, category, subcategory, tags,
        condition, images, sku, retail_price, floor_price, size_options
      )
      VALUES (
        ${title}, ${description || null}, ${brand || null}, ${category},
        ${subcategory || null}, ${tags || []}, ${condition},
        ${images || []}, ${sku}, ${parseFloat(retail_price)}, ${parseFloat(floor_price)},
        ${size_options || []}
      )
      RETURNING *
    `;
    return res.status(201).json({ product: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU already exists' });
    console.error('create product error:', err);
    return res.status(500).json({ error: 'Failed to create product' });
  }
};

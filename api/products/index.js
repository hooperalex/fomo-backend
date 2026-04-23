const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { category, limit = '20', offset = '0' } = req.query;

  try {
    let products;
    if (category) {
      products = await sql`
        SELECT id, title, description, brand, category, subcategory, tags,
               condition, images, sku, retail_price, floor_price, size_options,
               rating, rating_count, stock_status, created_at
        FROM products
        WHERE is_active = TRUE AND category = ${category}
        ORDER BY created_at DESC
        LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
      `;
    } else {
      products = await sql`
        SELECT id, title, description, brand, category, subcategory, tags,
               condition, images, sku, retail_price, floor_price, size_options,
               rating, rating_count, stock_status, created_at
        FROM products
        WHERE is_active = TRUE
        ORDER BY created_at DESC
        LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
      `;
    }
    return res.status(200).json({ products: products.rows });
  } catch (err) {
    console.error('products list error:', err);
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
};

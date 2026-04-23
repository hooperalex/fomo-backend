const { sql } = require('../../lib/db');
const { setCors, handleOptions } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;

  try {
    const { rows } = await sql`
      SELECT id, title, description, brand, category, subcategory, tags,
             condition, images, sku, retail_price, floor_price, size_options,
             rating, rating_count, stock_status, created_at
      FROM products
      WHERE id = ${id} AND is_active = TRUE
    `;
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ product: rows[0] });
  } catch (err) {
    console.error('product detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch product' });
  }
};

const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

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

  const { categories, gender, clothingSize, shoeSize } = req.body || {};

  if (!Array.isArray(categories) || categories.length < 2) {
    return res.status(400).json({ error: 'At least 2 categories required' });
  }

  const preferences = {
    categories,
    gender: gender || null,
    clothingSize: clothingSize || null,
    shoeSize: shoeSize || null,
    updatedAt: new Date().toISOString(),
  };

  try {
    await sql`
      UPDATE users
      SET preferences = ${JSON.stringify(preferences)}::jsonb
      WHERE id = ${user_id}
    `;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('preferences error:', err);
    return res.status(500).json({ error: 'Failed to save preferences' });
  }
};

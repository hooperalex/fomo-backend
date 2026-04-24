const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/interactions/profile
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let user_id;
  try {
    user_id = verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await sql`
      SELECT category_weights, total_interactions, total_purchases, last_updated
      FROM user_interest_profiles
      WHERE user_id = ${user_id}
    `;

    if (!rows[0]) {
      return res.status(200).json({
        categoryWeights: {},
        totalInteractions: 0,
        totalPurchases: 0,
        topCategories: [],
        lastUpdated: null,
      });
    }

    const profile = rows[0];
    const weights = profile.category_weights ?? {};

    const topCategories = Object.entries(weights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, weight]) => ({ category, weight }));

    return res.status(200).json({
      categoryWeights: weights,
      totalInteractions: profile.total_interactions,
      totalPurchases: profile.total_purchases,
      topCategories,
      lastUpdated: profile.last_updated,
    });
  } catch (err) {
    console.error('profile fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch interest profile' });
  }
};

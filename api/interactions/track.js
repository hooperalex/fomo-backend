const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

const INTERACTION_POINTS = {
  purchase:    5,
  bid:         3,
  detail_open: 2,
  view:        1,    // only when duration_seconds > 10
  skip:       -0.5,  // only when duration_seconds < 5
};

// Returns time-decay multiplier based on age of interaction
function decayMultiplier(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 30) return 0.25;
  if (ageDays > 7)  return 0.5;
  return 1.0;
}

function interactionPoints(type, durationSeconds) {
  if (type === 'view' && (durationSeconds == null || durationSeconds <= 10)) return 0;
  if (type === 'skip' && (durationSeconds == null || durationSeconds >= 5)) return 0;
  return INTERACTION_POINTS[type] ?? 0;
}

// POST /api/interactions/track
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

  const { productId, interactionType, durationSeconds, priceAtAction } = req.body || {};

  if (!productId || !interactionType) {
    return res.status(400).json({ error: 'productId and interactionType are required' });
  }
  if (!Object.keys(INTERACTION_POINTS).includes(interactionType)) {
    return res.status(400).json({ error: `interactionType must be one of: ${Object.keys(INTERACTION_POINTS).join(', ')}` });
  }

  try {
    // Resolve product category
    const productResult = await sql`SELECT id, category FROM products WHERE id = ${productId}`;
    if (!productResult.rows[0]) return res.status(404).json({ error: 'Product not found' });
    const { category } = productResult.rows[0];

    // Insert interaction
    await sql`
      INSERT INTO user_interactions (user_id, product_id, interaction_type, duration_seconds, price_at_action, category)
      VALUES (${user_id}, ${productId}, ${interactionType}, ${durationSeconds ?? null}, ${priceAtAction ?? null}, ${category})
    `;

    // Recalculate category weights from all interactions for this user
    const { rows: interactions } = await sql`
      SELECT interaction_type, duration_seconds, category, created_at
      FROM user_interactions
      WHERE user_id = ${user_id} AND category IS NOT NULL
    `;

    // Accumulate raw scores per category
    const rawScores = {};
    let totalInteractions = 0;
    let totalPurchases = 0;

    for (const row of interactions) {
      totalInteractions++;
      if (row.interaction_type === 'purchase') totalPurchases++;

      const pts = interactionPoints(row.interaction_type, row.duration_seconds);
      if (pts === 0) continue;

      const decay = decayMultiplier(row.created_at);
      rawScores[row.category] = (rawScores[row.category] ?? 0) + pts * decay;
    }

    // Normalize to 0-1 range
    const maxScore = Math.max(...Object.values(rawScores), 0);
    const categoryWeights = {};
    if (maxScore > 0) {
      for (const [cat, score] of Object.entries(rawScores)) {
        const normalized = score / maxScore;
        if (normalized > 0) categoryWeights[cat] = Math.round(normalized * 100) / 100;
      }
    }

    // Upsert interest profile
    await sql`
      INSERT INTO user_interest_profiles (user_id, category_weights, total_interactions, total_purchases, last_updated)
      VALUES (${user_id}, ${JSON.stringify(categoryWeights)}, ${totalInteractions}, ${totalPurchases}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        category_weights   = EXCLUDED.category_weights,
        total_interactions = EXCLUDED.total_interactions,
        total_purchases    = EXCLUDED.total_purchases,
        last_updated       = NOW()
    `;

    return res.status(201).json({ ok: true, category, categoryWeights });
  } catch (err) {
    console.error('track interaction error:', err);
    return res.status(500).json({ error: 'Failed to track interaction' });
  }
};

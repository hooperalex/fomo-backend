const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// GET /api/credits/history — paginated credit transaction history for user

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

  const { limit = '20', offset = '0' } = req.query;

  try {
    const { rows } = await sql`
      SELECT id, type, amount, currency, source_id, auction_id, status, memo, expires_at, created_at
      FROM credit_transactions
      WHERE user_id = ${user_id}
      ORDER BY created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;

    return res.status(200).json({ transactions: rows });
  } catch (err) {
    console.error('credit history error:', err);
    return res.status(500).json({ error: 'Failed to fetch credit history' });
  }
};

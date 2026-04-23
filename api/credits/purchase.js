const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');
const Stripe = require('stripe');

// Valid credit packs per spec (15-apple-pay-topup): $10 / $25 / $50 / $100
// 1 credit = $1 USD (integer units)
const CREDIT_PACKS = {
  10: { amount: 10, credits: 10 },
  25: { amount: 25, credits: 25 },
  50: { amount: 50, credits: 50 },
  100: { amount: 100, credits: 100 },
};

// POST /api/credits/purchase
// Body: { packAmount } — one of 10, 25, 50, 100
// Returns a Stripe PaymentIntent client_secret for Apple Pay.
// Credits are NOT minted here — they are minted by the webhook on payment_intent.succeeded.
// Per spec: capture-before-mint. No credits minted before capture succeeds.

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

  const { packAmount } = req.body || {};
  const pack = CREDIT_PACKS[parseInt(packAmount)];
  if (!pack) {
    return res.status(400).json({ error: 'Invalid pack. Choose 10, 25, 50, or 100.' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Fetch or create Stripe customer for this user
    const userResult = await sql`SELECT email FROM users WHERE id = ${user_id}`;
    const email = userResult.rows[0]?.email;

    // Create Stripe PaymentIntent
    const intent = await stripe.paymentIntents.create({
      amount: pack.amount * 100, // cents
      currency: 'usd',
      payment_method_types: ['card'], // Apple Pay surfaces as 'card' via Stripe
      metadata: {
        user_id,
        pack_amount: pack.amount,
        credits: pack.credits,
        source: 'fomo_topup',
      },
      receipt_email: email,
    });

    // Record topup intent in DB (pre-capture state)
    await sql`
      INSERT INTO credit_transactions (user_id, type, amount, source_id, status, memo)
      VALUES (${user_id}, 'topup', ${pack.credits}, ${intent.id}, 'pending', ${'Credit pack: $' + pack.amount})
    `;

    return res.status(200).json({
      clientSecret: intent.client_secret,
      intentId: intent.id,
      pack: { amount: pack.amount, credits: pack.credits },
    });
  } catch (err) {
    console.error('purchase error:', err);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
};

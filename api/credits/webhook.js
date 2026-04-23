const { sql } = require('../../lib/db');
const Stripe = require('stripe');

// POST /api/credits/webhook — Stripe webhook handler
// Mints credits on payment_intent.succeeded (capture-before-mint per spec).
// Idempotent: uses source_id (Stripe PaymentIntent id) to prevent double-mint.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // Stripe requires the raw body for signature verification
    const rawBody = req.body;
    event = stripe.webhooks.constructEvent(
      typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const { user_id, credits } = intent.metadata;

    if (!user_id || !credits) {
      return res.status(200).json({ received: true }); // Not our event
    }

    try {
      // Idempotent: only post if still pending for this intent
      await sql`
        UPDATE credit_transactions
        SET status = 'posted'
        WHERE source_id = ${intent.id} AND user_id = ${user_id} AND status = 'pending' AND type = 'topup'
      `;
    } catch (err) {
      console.error('Webhook credit mint error:', err);
      return res.status(500).json({ error: 'Failed to mint credits' });
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const { user_id } = intent.metadata || {};
    if (user_id) {
      await sql`
        UPDATE credit_transactions
        SET status = 'failed'
        WHERE source_id = ${intent.id} AND user_id = ${user_id} AND status = 'pending' AND type = 'topup'
      `;
    }
  }

  return res.status(200).json({ received: true });
};

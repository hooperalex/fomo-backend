const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

// POST /api/orders/checkout
// Body: { auctionId, bidId, amount, shippingFee, applePayToken }
// Called after Apple Pay authorization succeeds on device.
// Records the order and returns an estimated delivery date.

const SHIPPING_FEE_STANDARD = 5.99;
const SHIPPING_FEE_PRIME = 0.0;

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

  const { auctionId, bidId, amount, shippingFee, applePayToken } = req.body || {};
  if (!auctionId || !bidId || amount == null || shippingFee == null || !applePayToken) {
    return res.status(400).json({ error: 'auctionId, bidId, amount, shippingFee, and applePayToken are required' });
  }

  const parsedAmount = parseFloat(amount);
  const parsedShipping = parseFloat(shippingFee);
  if (isNaN(parsedAmount) || isNaN(parsedShipping)) {
    return res.status(400).json({ error: 'Invalid amount or shippingFee' });
  }

  // Validate shipping fee against Prime status
  const isPrime = await checkPrimeStatus(user_id);
  const expectedShipping = isPrime ? SHIPPING_FEE_PRIME : SHIPPING_FEE_STANDARD;
  if (Math.abs(parsedShipping - expectedShipping) > 0.01) {
    return res.status(422).json({ error: 'Shipping fee mismatch' });
  }

  try {
    // Verify bid belongs to this user and is accepted
    const bidCheck = await sql`
      SELECT id, amount, auction_id FROM bids
      WHERE id = ${bidId} AND user_id = ${user_id} AND status = 'accepted'
    `;
    if (!bidCheck.rows[0]) {
      return res.status(404).json({ error: 'Bid not found or not eligible for checkout' });
    }

    // Prevent duplicate orders for the same bid
    const existingOrder = await sql`
      SELECT id FROM orders WHERE bid_id = ${bidId}
    `;
    if (existingOrder.rows[0]) {
      return res.status(409).json({ error: 'Order already exists for this bid' });
    }

    // Estimated delivery: 3–5 business days from now
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
    const deliveryStr = estimatedDelivery.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });

    const { rows: [order] } = await sql`
      INSERT INTO orders (user_id, auction_id, bid_id, amount, shipping_fee, apple_pay_token, status, estimated_delivery)
      VALUES (
        ${user_id},
        ${auctionId},
        ${bidId},
        ${parsedAmount},
        ${parsedShipping},
        ${applePayToken},
        'paid',
        ${estimatedDelivery.toISOString()}
      )
      RETURNING id, auction_id, bid_id, amount, shipping_fee, status, estimated_delivery, created_at
    `;

    return res.status(201).json({
      order: {
        id: order.id,
        auction_id: order.auction_id,
        bid_id: order.bid_id,
        amount: parseFloat(order.amount),
        shipping_fee: parseFloat(order.shipping_fee),
        status: order.status,
        estimated_delivery: deliveryStr,
        created_at: order.created_at,
      },
    });
  } catch (err) {
    console.error('checkout error:', err);
    return res.status(500).json({ error: 'Checkout failed' });
  }
};

async function checkPrimeStatus(user_id) {
  try {
    const { rows } = await sql`
      SELECT 1 FROM subscriptions
      WHERE user_id = ${user_id}
        AND product_id = 'com.fomo.prime.monthly'
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

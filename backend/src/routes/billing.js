const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getSubscription } = require('../services/paypal');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();
router.use(requireAuth);

const STRIPE_PRICE_BY_TIER = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY,
};

const PAYPAL_PLAN_BY_TIER = {
  starter: process.env.PAYPAL_PLAN_STARTER,
  growth: process.env.PAYPAL_PLAN_GROWTH,
  pro: process.env.PAYPAL_PLAN_PRO,
  agency: process.env.PAYPAL_PLAN_AGENCY,
};

// --- Stripe ---

router.post('/stripe/create-checkout-session', async (req, res) => {
  const { tier } = req.body;
  const priceId = STRIPE_PRICE_BY_TIER[tier];
  if (!priceId) {
    return res.status(400).json({ error: 'Unknown plan tier.' });
  }

  const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = userResult.rows[0];

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard.html?checkout=success`,
    cancel_url: `${process.env.APP_URL}/pricing.html?checkout=cancelled`,
    metadata: { userId: user.id, tier },
  });

  res.json({ url: session.url });
});

router.get('/stripe/portal', async (req, res) => {
  const userResult = await db.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.userId]);
  const customerId = userResult.rows[0]?.stripe_customer_id;
  if (!customerId) {
    return res.status(400).json({ error: 'No billing account found yet.' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.APP_URL}/dashboard.html`,
  });

  res.json({ url: session.url });
});

// --- PayPal ---
// Frontend uses the PayPal JS SDK subscription buttons directly with the plan_id
// for the chosen tier, then posts the resulting subscriptionID here to confirm it.

router.get('/paypal/plan-id/:tier', (req, res) => {
  const planId = PAYPAL_PLAN_BY_TIER[req.params.tier];
  if (!planId) {
    return res.status(400).json({ error: 'Unknown plan tier.' });
  }
  res.json({ planId });
});

router.post('/paypal/confirm', async (req, res) => {
  const { subscriptionId, tier } = req.body;
  if (!subscriptionId || !tier) {
    return res.status(400).json({ error: 'subscriptionId and tier are required.' });
  }

  const subscription = await getSubscription(subscriptionId);
  if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
    return res.status(400).json({ error: `Subscription is not active (status: ${subscription.status}).` });
  }

  await db.query(
    `UPDATE users SET paypal_subscription_id = $1, plan_tier = $2, plan_status = 'active' WHERE id = $3`,
    [subscriptionId, tier, req.userId]
  );

  res.json({ ok: true });
});

module.exports = router;

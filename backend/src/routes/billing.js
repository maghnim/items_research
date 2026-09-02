const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getSubscription } = require('../services/paypal');
const { isValidCombo, envKey } = require('../utils/pricing');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();
router.use(requireAuth);

function stripePriceId(category, months) {
  return process.env[envKey('STRIPE_PRICE', category, months)];
}

function paypalPlanId(category, months) {
  return process.env[envKey('PAYPAL_PLAN', category, months)];
}

// --- Stripe ---
// Billing always runs in EUR (the merchant's base currency) regardless of what the
// pricing page displayed — the frontend's USD figure for English-speaking visitors is a
// display-only estimate, disclosed as such; the actual charge is EUR, same as any
// international customer paying a European merchant.

router.post('/stripe/create-checkout-session', asyncHandler(async (req, res) => {
  const { category, months } = req.body;
  if (!isValidCombo(category, Number(months))) {
    return res.status(400).json({ error: 'Unknown plan category or billing term.' });
  }

  const priceId = stripePriceId(category, months);
  if (!priceId) {
    return res.status(400).json({ error: `Stripe price is not configured yet for ${category} / ${months} month(s).` });
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
    metadata: { userId: user.id, category, months: String(months) },
  });

  res.json({ url: session.url });
}));

router.get('/stripe/portal', asyncHandler(async (req, res) => {
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
}));

// --- PayPal ---
// Frontend uses the PayPal JS SDK subscription buttons directly with the plan_id
// for the chosen category+term, then posts the resulting subscriptionID here to confirm it.

router.get('/paypal/plan-id/:category/:months', (req, res) => {
  const { category, months } = req.params;
  if (!isValidCombo(category, Number(months))) {
    return res.status(400).json({ error: 'Unknown plan category or billing term.' });
  }
  const planId = paypalPlanId(category, months);
  if (!planId) {
    return res.status(400).json({ error: `PayPal plan is not configured yet for ${category} / ${months} month(s).` });
  }
  res.json({ planId });
});

router.post('/paypal/confirm', asyncHandler(async (req, res) => {
  const { subscriptionId, category, months } = req.body;
  if (!subscriptionId || !isValidCombo(category, Number(months))) {
    return res.status(400).json({ error: 'subscriptionId, category, and months are required.' });
  }

  const subscription = await getSubscription(subscriptionId);
  if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
    return res.status(400).json({ error: `Subscription is not active (status: ${subscription.status}).` });
  }

  await db.query(
    `UPDATE users SET paypal_subscription_id = $1, plan_tier = $2, plan_duration_months = $3, plan_status = 'active' WHERE id = $4`,
    [subscriptionId, category, months, req.userId]
  );

  res.json({ ok: true });
}));

module.exports = router;

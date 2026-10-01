const express = require('express');
const Stripe = require('stripe');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getSubscription, createOrder, captureOrder } = require('../services/paypal');
const { polar, createDynamicCheckout } = require('../services/polar');
const { isValidCombo, envKey, trialPriceFor, priceFor, getCategoryLimits } = require('../utils/pricing');
const { isTrialEligible, grantTrial } = require('../services/trials');
const { stripeIsConfigured } = require('../services/paymentHealth');
const { signToken } = require('./auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

function stripePriceId(category, months) {
  return process.env[envKey('STRIPE_PRICE', category, months)];
}

function paypalPlanId(category, months) {
  return process.env[envKey('PAYPAL_PLAN', category, months)];
}

// Which payment options the frontend should offer (pricing.js, checkout.js).
router.get('/providers', (req, res) => {
  res.json({ polar: true, stripe: stripeIsConfigured() });
});

const STRIPE_NOT_SET_UP = 'Card payment via Stripe is not available yet. Please use the other checkout option.';

// --- Polar guest checkout (plan purchases only) ---
// These three routes must stay above router.use(requireAuth) below: pricing.html lets
// anyone buy a plan without an account first. A checkout created with no req.userId gets
// metadata.guest = 'true' instead of a userId; the webhook (routes/webhooks.js) uses that
// to auto-create the account, and claim-account below is how the buyer sets a real
// password for it afterward. A checkout id is effectively a one-time bearer credential
// here, but ONLY for checkouts explicitly marked guest — a normal logged-in purchase never
// has that metadata, so this can never be used to touch an existing authenticated account.

router.post('/polar/create-checkout-session', optionalAuth, asyncHandler(async (req, res) => {
  const { category, months, locale } = req.body;
  const users = Number(req.body.users || 1);
  if (!isValidCombo(category, Number(months), users)) {
    return res.status(400).json({ error: 'Unknown plan category, billing term or number of users.' });
  }

  const productId = process.env.POLAR_PRODUCT_PLAN;
  if (!productId) {
    return res.status(400).json({ error: 'Polar payment is not configured yet.' });
  }

  let customerEmail;
  let metadata;
  if (req.userId) {
    const userResult = await db.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    customerEmail = userResult.rows[0]?.email;
    metadata = { userId: req.userId, type: 'plan', category, months: String(months), users: String(users) };
  } else {
    // No account yet — Polar's own checkout form collects the email; the webhook
    // creates the account from it once payment succeeds.
    metadata = { type: 'plan', category, months: String(months), users: String(users), guest: 'true' };
  }

  const checkout = await createDynamicCheckout({
    productId,
    amountEur: priceFor(category, Number(months), users),
    successUrl: `${process.env.APP_URL}/payment-success.html?checkout_id={CHECKOUT_ID}`,
    customerEmail,
    metadata,
    locale,
  });

  res.json({ url: checkout.url });
}));

// Fetched by payment-success.html after Polar redirects back with ?checkout_id={CHECKOUT_ID}.
// Reads straight from Polar (not our DB) since the webhook may not have processed yet —
// the checkout object itself already reflects the final payment status immediately.
router.get('/polar/checkout/:checkoutId', optionalAuth, asyncHandler(async (req, res) => {
  let checkout;
  try {
    checkout = await polar.checkouts.get({ id: req.params.checkoutId });
  } catch (err) {
    console.error('[billing/polar/checkout] get failed:', err.message);
    return res.status(404).json({ error: 'Checkout not found.' });
  }

  const isGuestCheckout = checkout.metadata?.guest === 'true';
  if (!isGuestCheckout && checkout.metadata?.userId !== req.userId) {
    return res.status(403).json({ error: 'Not authorized to view this checkout.' });
  }

  let needsPasswordSetup = false;
  if (isGuestCheckout && checkout.status === 'succeeded' && checkout.customerEmail) {
    const userResult = await db.query(
      'SELECT password_needs_setup FROM users WHERE email = $1',
      [checkout.customerEmail.toLowerCase()]
    );
    needsPasswordSetup = userResult.rows[0]?.password_needs_setup || false;
  }

  res.json({
    status: checkout.status,
    amount: checkout.totalAmount / 100,
    currency: checkout.currency,
    customerName: checkout.customerName,
    customerEmail: checkout.customerEmail,
    productName: checkout.product?.name || null,
    metadata: checkout.metadata,
    createdAt: checkout.createdAt,
    needsPasswordSetup,
  });
}));

// Intentionally unauthenticated (no requireAuth, no optionalAuth) — the checkout id +
// its guest/succeeded status IS the proof of purchase here. Only ever matches a user row
// with password_needs_setup = true, and flips it to false on success, so this can't be
// replayed against the same account twice, and can never touch a normally-signed-up account.
router.post('/polar/claim-account', asyncHandler(async (req, res) => {
  const { checkoutId, password } = req.body;
  if (!checkoutId || !password || password.length < 8) {
    return res.status(400).json({ error: 'checkoutId and a password (8+ chars) are required.' });
  }

  let checkout;
  try {
    checkout = await polar.checkouts.get({ id: checkoutId });
  } catch (err) {
    return res.status(404).json({ error: 'Checkout not found.' });
  }

  if (checkout.status !== 'succeeded' || checkout.metadata?.guest !== 'true') {
    return res.status(400).json({ error: 'This checkout is not eligible for account setup.' });
  }
  if (!checkout.customerEmail) {
    return res.status(400).json({ error: 'No email associated with this checkout.' });
  }

  const userResult = await db.query(
    'SELECT * FROM users WHERE email = $1 AND password_needs_setup = true',
    [checkout.customerEmail.toLowerCase()]
  );
  const user = userResult.rows[0];
  if (!user) {
    return res.status(400).json({
      error: 'Account not ready yet, or already set up. If you just paid, wait a few seconds and try again.',
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    'UPDATE users SET password_hash = $1, password_needs_setup = false WHERE id = $2',
    [passwordHash, user.id]
  );

  const token = signToken(user.id);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      plan_tier: user.plan_tier,
      plan_status: user.plan_status,
      plan_users: user.plan_users,
      trial_expires_at: user.trial_expires_at,
    },
  });
}));

router.use(requireAuth);

// --- Trials ---
// A 24-hour trial of one plan, once per account (utils/pricing.js, services/trials.js).
// Free trials are granted right here; a paid one (VIP) goes through a checkout below
// and is granted by the payment webhook.

router.post('/trial/start', asyncHandler(async (req, res) => {
  const { category } = req.body;
  const price = trialPriceFor(category);
  if (price === null) {
    return res.status(400).json({ error: 'Unknown plan category.' });
  }
  if (price > 0) {
    return res.status(400).json({ error: 'This trial is paid — start it from its checkout link.' });
  }
  if (!(await grantTrial(req.userId, category))) {
    return res.status(409).json({ error: 'This account has already used its free trial or has a plan.' });
  }
  res.json({ ok: true });
}));

// Shared checks for the paid-trial checkout routes. Sends the error response itself and
// returns null when the request can't go ahead.
async function paidTrialOrReject(req, res) {
  const { category } = req.body;
  const price = trialPriceFor(category);
  if (price === null) {
    res.status(400).json({ error: 'Unknown plan category.' });
    return null;
  }
  if (price === 0) {
    res.status(400).json({ error: 'This trial is free — no payment needed.' });
    return null;
  }
  if (!(await isTrialEligible(req.userId))) {
    res.status(409).json({ error: 'This account has already used its trial or has a plan.' });
    return null;
  }
  return { category, price };
}

// --- Stripe ---
// Billing always runs in EUR (the merchant's base currency) regardless of what the
// pricing page displayed — the frontend's USD figure for English-speaking visitors is a
// display-only estimate, disclosed as such; the actual charge is EUR, same as any
// international customer paying a European merchant.

// One-time charge for a paid plan trial. Not a subscription — mode: 'payment'. The
// amount comes from utils/pricing.js via price_data, so no Stripe Price has to exist.
router.post('/stripe/create-trial-checkout-session', asyncHandler(async (req, res) => {
  if (!stripeIsConfigured()) {
    return res.status(400).json({ error: STRIPE_NOT_SET_UP });
  }
  const trial = await paidTrialOrReject(req, res);
  if (!trial) return;

  const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = userResult.rows[0];

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(trial.price * 100),
        product_data: { name: `Pricera ${getCategoryLimits(trial.category).label} — 24-hour trial` },
      },
      quantity: 1,
    }],
    success_url: `${process.env.APP_URL}/dashboard.html?checkout=trial-success`,
    cancel_url: `${process.env.APP_URL}/pricing.html?checkout=cancelled`,
    metadata: { userId: user.id, type: 'trial', trialType: '24h', category: trial.category },
  });

  res.json({ url: session.url });
}));

router.post('/stripe/create-checkout-session', asyncHandler(async (req, res) => {
  if (!stripeIsConfigured()) {
    return res.status(400).json({ error: STRIPE_NOT_SET_UP });
  }
  const { category, months } = req.body;
  if (!isValidCombo(category, Number(months))) {
    return res.status(400).json({ error: 'Unknown plan category or billing term.' });
  }
  // Stripe prices exist per (category, months) for 1 user only; multi-user plans go
  // through Polar, which charges the computed amount (checkout.js falls back to it).
  if (Number(req.body.users || 1) !== 1) {
    return res.status(400).json({ error: 'Plans with more than 1 user are paid through the other checkout option.' });
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

  // plan_expires_at = NULL: a subscription renews, so drop any expiry left by a trial.
  await db.query(
    `UPDATE users SET paypal_subscription_id = $1, plan_tier = $2, plan_duration_months = $3, plan_users = 1, plan_status = 'active', plan_expires_at = NULL WHERE id = $4`,
    [subscriptionId, category, months, req.userId]
  );

  res.json({ ok: true });
}));

// One-time paid trial via PayPal Orders API (not a Billing Plan/Subscription).
router.post('/paypal/create-trial-order', asyncHandler(async (req, res) => {
  const trial = await paidTrialOrReject(req, res);
  if (!trial) return;
  const order = await createOrder(trial.price, 'EUR');
  res.json({ orderId: order.id });
}));

router.post('/paypal/capture-trial-order', asyncHandler(async (req, res) => {
  const { orderId, category } = req.body;
  const price = trialPriceFor(category);
  if (!orderId || !price) {
    return res.status(400).json({ error: 'orderId and a paid-trial category are required.' });
  }

  const capture = await captureOrder(orderId);
  if (capture.status !== 'COMPLETED') {
    return res.status(400).json({ error: `Payment not completed (status: ${capture.status}).` });
  }

  // Don't trust the client's category blindly — confirm the amount actually captured
  // by PayPal matches what that plan's trial costs before granting it.
  const captured = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
  if (!captured || captured.currency_code !== 'EUR' || Number(captured.value) !== price) {
    return res.status(400).json({ error: 'Captured amount does not match the requested trial.' });
  }

  if (!(await grantTrial(req.userId, category))) {
    return res.status(409).json({ error: 'This account has already used its trial or has a plan.' });
  }
  res.json({ ok: true });
}));

// --- Polar trial unlock (still requires an account — guest checkout is plan-only) ---
// Polar has no Stripe-style "bill every N months" recurring interval, so every Polar
// checkout here (trial and paid plans alike) is a one-time payment for an amount read
// straight from utils/pricing.js and handed to Polar per-checkout — see services/polar.js.
// Two generic one-time Products (POLAR_PRODUCT_TRIAL / POLAR_PRODUCT_PLAN) cover all combos;
// the actual category/months lives only in checkout metadata.

router.post('/polar/create-trial-checkout-session', asyncHandler(async (req, res) => {
  const trial = await paidTrialOrReject(req, res);
  if (!trial) return;

  const productId = process.env.POLAR_PRODUCT_TRIAL;
  if (!productId) {
    return res.status(400).json({ error: 'Trial payment is not configured yet.' });
  }

  const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = userResult.rows[0];

  const checkout = await createDynamicCheckout({
    productId,
    amountEur: trial.price,
    successUrl: `${process.env.APP_URL}/payment-success.html?checkout_id={CHECKOUT_ID}`,
    customerEmail: user.email,
    metadata: { userId: user.id, type: 'trial', trialType: '24h', category: trial.category },
    locale: req.body.locale,
  });

  res.json({ url: checkout.url });
}));

module.exports = router;

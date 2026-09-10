const express = require('express');
const Stripe = require('stripe');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getSubscription, createOrder, captureOrder } = require('../services/paypal');
const { polar, createDynamicCheckout } = require('../services/polar');
const { isValidCombo, envKey, TRIALS, isValidTrialType, trialDurationMs, trialEnvKey, priceFor } = require('../utils/pricing');
const { signToken } = require('./auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

function stripePriceId(category, months) {
  return process.env[envKey('STRIPE_PRICE', category, months)];
}

function paypalPlanId(category, months) {
  return process.env[envKey('PAYPAL_PLAN', category, months)];
}

// --- Polar guest checkout (plan purchases only) ---
// These three routes must stay above router.use(requireAuth) below: pricing.html lets
// anyone buy a plan without an account first. A checkout created with no req.userId gets
// metadata.guest = 'true' instead of a userId; the webhook (routes/webhooks.js) uses that
// to auto-create the account, and claim-account below is how the buyer sets a real
// password for it afterward. A checkout id is effectively a one-time bearer credential
// here, but ONLY for checkouts explicitly marked guest — a normal logged-in purchase never
// has that metadata, so this can never be used to touch an existing authenticated account.

router.post('/polar/create-checkout-session', optionalAuth, asyncHandler(async (req, res) => {
  const { category, months } = req.body;
  if (!isValidCombo(category, Number(months))) {
    return res.status(400).json({ error: 'Unknown plan category or billing term.' });
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
    metadata = { userId: req.userId, type: 'plan', category, months: String(months) };
  } else {
    // No account yet — Polar's own checkout form collects the email; the webhook
    // creates the account from it once payment succeeds.
    metadata = { type: 'plan', category, months: String(months), guest: 'true' };
  }

  const checkout = await createDynamicCheckout({
    productId,
    amountEur: priceFor(category, Number(months)),
    successUrl: `${process.env.APP_URL}/payment-success.html?checkout_id={CHECKOUT_ID}`,
    customerEmail,
    metadata,
  });

  res.json({ url: checkout.url, debugId: checkout.id }); // TEMP debug field, will revert
}));

// Fetched by payment-success.html after Polar redirects back with ?checkout_id={CHECKOUT_ID}.
// Reads straight from Polar (not our DB) since the webhook may not have processed yet —
// the checkout object itself already reflects the final payment status immediately.
router.get('/polar/checkout/:checkoutId', optionalAuth, asyncHandler(async (req, res) => {
  let checkout;
  try {
    checkout = await polar.checkouts.get({ id: req.params.checkoutId });
  } catch (err) {
    console.error('[billing/polar/checkout] get failed:', err.message, err.statusCode, err.body);
    // TEMPORARY: surfacing the real error to diagnose a live 404 mystery — revert before merging to main long-term.
    return res.status(404).json({ error: 'Checkout not found.', debug: { message: err.message, statusCode: err.statusCode, body: err.body } });
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
      trial_expires_at: user.trial_expires_at,
    },
  });
}));

router.use(requireAuth);

// --- Stripe ---
// Billing always runs in EUR (the merchant's base currency) regardless of what the
// pricing page displayed — the frontend's USD figure for English-speaking visitors is a
// display-only estimate, disclosed as such; the actual charge is EUR, same as any
// international customer paying a European merchant.

// One-time charge that unlocks a fixed window of trial-tier access. Two options
// (24h / 7d, see utils/pricing.js). Not a subscription — mode: 'payment', no
// recurring billing until the user picks a real plan.
router.post('/stripe/create-trial-checkout-session', asyncHandler(async (req, res) => {
  const { trialType } = req.body;
  if (!isValidTrialType(trialType)) {
    return res.status(400).json({ error: 'Unknown trial type.' });
  }

  const priceId = process.env[trialEnvKey('STRIPE_PRICE', trialType)];
  if (!priceId) {
    return res.status(400).json({ error: 'Trial payment is not configured yet.' });
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
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard.html?checkout=trial-success`,
    cancel_url: `${process.env.APP_URL}/signup.html?checkout=cancelled`,
    metadata: { userId: user.id, type: 'trial', trialType },
  });

  res.json({ url: session.url });
}));

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

// One-time trial unlock via PayPal Orders API (not a Billing Plan/Subscription).
router.post('/paypal/create-trial-order', asyncHandler(async (req, res) => {
  const { trialType } = req.body;
  if (!isValidTrialType(trialType)) {
    return res.status(400).json({ error: 'Unknown trial type.' });
  }
  const order = await createOrder(TRIALS[trialType].priceEur, 'EUR');
  res.json({ orderId: order.id });
}));

router.post('/paypal/capture-trial-order', asyncHandler(async (req, res) => {
  const { orderId, trialType } = req.body;
  if (!orderId || !isValidTrialType(trialType)) {
    return res.status(400).json({ error: 'orderId and a valid trialType are required.' });
  }

  const capture = await captureOrder(orderId);
  if (capture.status !== 'COMPLETED') {
    return res.status(400).json({ error: `Payment not completed (status: ${capture.status}).` });
  }

  // Don't trust the client's trialType blindly — confirm the amount actually captured
  // by PayPal matches what that trial type costs before granting its duration.
  const captured = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
  const expected = TRIALS[trialType];
  if (!captured || captured.currency_code !== 'EUR' || Number(captured.value) !== expected.priceEur) {
    return res.status(400).json({ error: 'Captured amount does not match the requested trial type.' });
  }

  const trialExpiresAt = new Date(Date.now() + trialDurationMs(trialType));
  await db.query(
    `UPDATE users SET plan_status = 'active', trial_expires_at = $1, trial_type = $2 WHERE id = $3`,
    [trialExpiresAt, trialType, req.userId]
  );

  res.json({ ok: true });
}));

// --- Polar trial unlock (still requires an account — guest checkout is plan-only) ---
// Polar has no Stripe-style "bill every N months" recurring interval, so every Polar
// checkout here (trial and paid plans alike) is a one-time payment for an amount read
// straight from utils/pricing.js and handed to Polar per-checkout — see services/polar.js.
// Two generic one-time Products (POLAR_PRODUCT_TRIAL / POLAR_PRODUCT_PLAN) cover all combos;
// the actual category/months/trialType lives only in checkout metadata.

router.post('/polar/create-trial-checkout-session', asyncHandler(async (req, res) => {
  const { trialType } = req.body;
  if (!isValidTrialType(trialType)) {
    return res.status(400).json({ error: 'Unknown trial type.' });
  }

  const productId = process.env.POLAR_PRODUCT_TRIAL;
  if (!productId) {
    return res.status(400).json({ error: 'Trial payment is not configured yet.' });
  }

  const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = userResult.rows[0];

  const checkout = await createDynamicCheckout({
    productId,
    amountEur: TRIALS[trialType].priceEur,
    successUrl: `${process.env.APP_URL}/payment-success.html?checkout_id={CHECKOUT_ID}`,
    customerEmail: user.email,
    metadata: { userId: user.id, type: 'trial', trialType },
  });

  res.json({ url: checkout.url });
}));

module.exports = router;

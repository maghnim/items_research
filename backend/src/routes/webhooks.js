const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const { CATEGORIES, DURATIONS, envKey, isValidTrialType, trialDurationMs } = require('../utils/pricing');
const { verifyWebhookSignature } = require('../services/paypal');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

// Reverse-lookup table: Stripe price ID -> { category, months }, built from the same
// 16 STRIPE_PRICE_<CATEGORY>_<MONTHS> env vars used to create checkout sessions.
const PLAN_BY_STRIPE_PRICE = {};
for (const category of CATEGORIES) {
  for (const months of DURATIONS) {
    const priceId = process.env[envKey('STRIPE_PRICE', category, months)];
    if (priceId) PLAN_BY_STRIPE_PRICE[priceId] = { category, months };
  }
}

// NOTE: this route must receive the raw body (see server.js) for signature verification.
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhooks/stripe] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const type = session.metadata?.type;

        if (userId && type === 'trial') {
          const trialType = session.metadata?.trialType;
          if (isValidTrialType(trialType)) {
            const trialExpiresAt = new Date(Date.now() + trialDurationMs(trialType));
            await db.query(
              `UPDATE users SET plan_status = 'active', trial_expires_at = $1, trial_type = $2 WHERE id = $3`,
              [trialExpiresAt, trialType, userId]
            );
          } else {
            console.error('[webhooks/stripe] trial checkout completed with unknown trialType:', trialType);
          }
        } else if (userId && session.metadata?.category) {
          const subscriptionId = session.subscription;
          const category = session.metadata.category;
          const months = session.metadata.months;
          await db.query(
            `UPDATE users SET stripe_subscription_id = $1, plan_tier = $2, plan_duration_months = $3, plan_status = 'active' WHERE id = $4`,
            [subscriptionId, category, months, userId]
          );
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        const plan = PLAN_BY_STRIPE_PRICE[priceId];
        const status = sub.status === 'active' ? 'active' : sub.status;
        await db.query(
          `UPDATE users
           SET plan_tier = COALESCE($1, plan_tier),
               plan_duration_months = COALESCE($2, plan_duration_months),
               plan_status = $3
           WHERE stripe_customer_id = $4`,
          [plan?.category || null, plan?.months || null, status, sub.customer]
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.query(
          `UPDATE users SET plan_tier = 'trial', plan_status = 'canceled' WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[webhooks/stripe] handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

// PayPal sends JSON events (BILLING.SUBSCRIPTION.CANCELLED, .SUSPENDED, .ACTIVATED, etc).
router.post('/paypal', express.json(), async (req, res) => {
  const event = req.body;
  try {
    let verified;
    try {
      verified = await verifyWebhookSignature(req.headers, event);
    } catch (err) {
      console.error('[webhooks/paypal] signature verification request failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed.' });
    }
    if (!verified) {
      console.error('[webhooks/paypal] signature verification rejected the event.');
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const resource = event.resource || {};
    const subscriptionId = resource.id;

    if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED' || event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      await db.query(
        `UPDATE users SET plan_status = 'canceled' WHERE paypal_subscription_id = $1`,
        [subscriptionId]
      );
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      await db.query(
        `UPDATE users SET plan_status = 'active' WHERE paypal_subscription_id = $1`,
        [subscriptionId]
      );
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[webhooks/paypal] handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

module.exports = router;

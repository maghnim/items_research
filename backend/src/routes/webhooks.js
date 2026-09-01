const express = require('express');
const Stripe = require('stripe');
const db = require('../db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const router = express.Router();

const TIER_BY_STRIPE_PRICE = {
  [process.env.STRIPE_PRICE_STARTER]: 'starter',
  [process.env.STRIPE_PRICE_GROWTH]: 'growth',
  [process.env.STRIPE_PRICE_PRO]: 'pro',
  [process.env.STRIPE_PRICE_AGENCY]: 'agency',
};

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
        const subscriptionId = session.subscription;
        const userId = session.metadata?.userId;
        const tier = session.metadata?.tier;
        if (userId && tier) {
          await db.query(
            `UPDATE users SET stripe_subscription_id = $1, plan_tier = $2, plan_status = 'active' WHERE id = $3`,
            [subscriptionId, tier, userId]
          );
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        const tier = TIER_BY_STRIPE_PRICE[priceId];
        const status = sub.status === 'active' ? 'active' : sub.status;
        await db.query(
          `UPDATE users SET plan_tier = COALESCE($1, plan_tier), plan_status = $2 WHERE stripe_customer_id = $3`,
          [tier || null, status, sub.customer]
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
// In production, verify the signature via PayPal's /v1/notifications/verify-webhook-signature.
router.post('/paypal', express.json(), async (req, res) => {
  const event = req.body;
  try {
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

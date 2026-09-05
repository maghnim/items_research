const axios = require('axios');

const BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(
    `${BASE_URL}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data.access_token;
}

async function getSubscription(subscriptionId) {
  const token = await getAccessToken();
  const response = await axios.get(`${BASE_URL}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

// One-time payment (PayPal Orders API v2) — used for the EUR 2.99 trial unlock, which
// isn't a recurring subscription.
async function createOrder(amount, currency) {
  const token = await getAccessToken();
  const response = await axios.post(
    `${BASE_URL}/v2/checkout/orders`,
    {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount.toFixed(2) } }],
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const response = await axios.post(
    `${BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {},
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

// Verifies an incoming webhook actually came from PayPal, per
// https://developer.paypal.com/api/rest/webhooks/rest/#link-verifysignature
async function verifyWebhookSignature(headers, body) {
  const token = await getAccessToken();
  const response = await axios.post(
    `${BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return response.data.verification_status === 'SUCCESS';
}

module.exports = { getAccessToken, getSubscription, createOrder, captureOrder, verifyWebhookSignature, BASE_URL };

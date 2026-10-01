require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');
const { startScheduler } = require('./services/scheduler');
const { paymentHealth } = require('./services/paymentHealth');
const { asyncHandler } = require('./middleware/asyncHandler');

const app = express();

// Defense-in-depth: every Express route is wrapped with asyncHandler (see
// middleware/asyncHandler.js), but this catches anything outside the request/response
// cycle (e.g. a stray promise in a background task) so one bad error can't take the
// whole process — and every user's requests with it — down.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// maxAge: browsers cache the CORS preflight for a day instead of repeating it per request.
app.use(cors({ origin: process.env.APP_URL || '*', maxAge: 86400 }));

// Webhooks must be mounted BEFORE express.json() so Stripe's route can read the raw body.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'pricepilot-backend' }));

// 503 when Polar checkouts would fail. Polled by .github/workflows/payments-health.yml,
// which emails the repo owner on failure.
app.get('/api/health/payments', asyncHandler(async (req, res) => {
  const health = await paymentHealth();
  res.status(health.polar.ok ? 200 : 503).json(health);
}));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/billing', billingRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Pricera API listening on port ${PORT}`);
  startScheduler();
  paymentHealth().then(({ polar }) => {
    if (polar.ok) console.log(`[payments] Polar OK (${polar.mode} mode)`);
    else console.error(`[payments] POLAR CHECKOUT IS BROKEN: ${polar.error}`);
  });
});

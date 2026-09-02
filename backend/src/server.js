require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');
const { startScheduler } = require('./services/scheduler');

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

app.use(cors({ origin: process.env.APP_URL || '*' }));

// Webhooks must be mounted BEFORE express.json() so Stripe's route can read the raw body.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'pricepilot-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/billing', billingRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`PricePilot API listening on port ${PORT}`);
  startScheduler();
});

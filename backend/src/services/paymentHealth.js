const { polar } = require('./polar');
const { CATEGORIES, DURATIONS, envKey } = require('../utils/pricing');

// Stripe counts as set up only with a real secret key and all 16 plan prices. Until then
// the Stripe routes refuse up front and the frontend hides the Stripe option.
function stripeIsConfigured() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_') || key.includes('placeholder')) return false;
  return CATEGORIES.every((c) => DURATIONS.every((m) => process.env[envKey('STRIPE_PRICE', c, m)]));
}

function polarMode() {
  return process.env.POLAR_MODE === 'production' ? 'production' : 'sandbox';
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer from Polar within ${ms / 1000}s`)), ms)),
  ]);
}

// Read-only check that everything a Polar checkout needs is right: the token is accepted
// in POLAR_MODE, and both products exist there and aren't archived. Catches the failure
// where the token belongs to one Polar environment and POLAR_MODE points at the other.
async function checkPolar() {
  const mode = polarMode();
  if (!process.env.POLAR_ACCESS_TOKEN) return { ok: false, mode, error: 'POLAR_ACCESS_TOKEN is not set.' };

  for (const envName of ['POLAR_PRODUCT_PLAN', 'POLAR_PRODUCT_TRIAL']) {
    const id = process.env[envName];
    if (!id) return { ok: false, mode, error: `${envName} is not set.` };
    try {
      const product = await withTimeout(polar.products.get({ id }), 10000);
      if (product.isArchived) return { ok: false, mode, error: `${envName} is archived in Polar.` };
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        return { ok: false, mode, error: `Polar rejected POLAR_ACCESS_TOKEN in ${mode} mode. Check that POLAR_MODE matches the environment the token was created in.` };
      }
      if (err.statusCode === 404 || err.statusCode === 422) {
        return { ok: false, mode, error: `${envName} was not found in Polar ${mode} mode.` };
      }
      return { ok: false, mode, error: `Could not reach Polar: ${err.message}` };
    }
  }
  return { ok: true, mode };
}

// Cached so the public health endpoint can't be used to hammer the Polar API.
let cached = null;
let cachedAt = 0;

async function paymentHealth() {
  if (!cached || Date.now() - cachedAt > 60 * 1000) {
    cached = { polar: await checkPolar(), stripe: { configured: stripeIsConfigured() } };
    cachedAt = Date.now();
  }
  return cached;
}

module.exports = { paymentHealth, stripeIsConfigured };

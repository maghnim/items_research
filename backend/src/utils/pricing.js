// Subscription pricing: 4 categories x 4 billing terms, base currency EUR.
// Feature limits (tracked-product count, scrape frequency) depend only on the
// category — the billing term just changes how many months you pay for up front.

const CATEGORIES = ['standard', 'premium', 'premiumplus', 'vip'];
const DURATIONS = [1, 3, 6, 12];

// The trial itself is a paid, one-time unlock (not a subscription): pay once, get 14
// days of trial-tier access. STRIPE_PRICE_TRIAL is a one-time (non-recurring) Price.
const TRIAL_PRICE_EUR = 2.99;
const TRIAL_DURATION_DAYS = 14;

const PRICES_EUR = {
  standard: { 1: 9.99, 3: 19.99, 6: 29.99, 12: 45.99 },
  premium: { 1: 10.99, 3: 25.99, 6: 39.99, 12: 49.99 },
  premiumplus: { 1: 11.99, 3: 28.99, 6: 45.99, 12: 64.99 },
  vip: { 1: 15.99, 3: 34.99, 6: 59.99, 12: 99.99 },
};

const CATEGORY_LIMITS = {
  trial: { label: 'Trial', maxProducts: 5, checkEveryMinutes: 360 },
  standard: { label: 'Standard', maxProducts: 10, checkEveryMinutes: 360 },
  premium: { label: 'Premium', maxProducts: 50, checkEveryMinutes: 60 },
  premiumplus: { label: 'Premium Plus', maxProducts: 200, checkEveryMinutes: 15 },
  vip: { label: 'VIP', maxProducts: Infinity, checkEveryMinutes: 15 },
};

function isValidCombo(category, months) {
  return CATEGORIES.indexOf(category) !== -1 && Object.prototype.hasOwnProperty.call(PRICES_EUR[category] || {}, months);
}

function priceFor(category, months) {
  if (!isValidCombo(category, months)) return null;
  return PRICES_EUR[category][months];
}

function getCategoryLimits(category) {
  return CATEGORY_LIMITS[category] || CATEGORY_LIMITS.trial;
}

// Stripe/PayPal price identifiers are configured per (category, months) combo via env vars,
// e.g. STRIPE_PRICE_STANDARD_1, STRIPE_PRICE_PREMIUM_3, PAYPAL_PLAN_VIP_12, ...
function envKey(prefix, category, months) {
  return `${prefix}_${category.toUpperCase()}_${months}`;
}

module.exports = {
  CATEGORIES,
  DURATIONS,
  PRICES_EUR,
  CATEGORY_LIMITS,
  TRIAL_PRICE_EUR,
  TRIAL_DURATION_DAYS,
  isValidCombo,
  priceFor,
  getCategoryLimits,
  envKey,
};

// Subscription pricing: 4 categories x 4 billing terms x 1-4 users, base currency EUR.
// Feature limits (tracked-product count, scrape frequency) depend only on the
// category — the billing term just changes how many months you pay for up front.

const CATEGORIES = ['standard', 'premium', 'premiumplus', 'vip'];
const DURATIONS = [1, 3, 6, 12];

// Users per account. Extra users are charged at a growing discount on the 1-user price
// (x1.8 = -10%, x2.55 = -15%, x3.2 = -20%), as percentages so prices stay exact cents.
// The count is recorded on the account (users.plan_users); not enforced yet.
const USERS = [1, 2, 3, 4];
const USER_PRICE_PCT = { 1: 100, 2: 180, 3: 255, 4: 320 };

// Every plan has a 24-hour trial of that plan (its full limits, see CATEGORY_LIMITS).
// Free for Standard / Premium / Premium Plus; VIP's is a one-time €2.99 payment.
// One trial per account — see services/trials.js.
const TRIAL_HOURS = 24;
const TRIAL_PRICES_EUR = { standard: 0, premium: 0, premiumplus: 0, vip: 2.99 };

// Trials sold before per-plan trials existed (€1 / 24h and €3.99 / 7d, trial-tier
// access). Only kept so a webhook for a checkout started before the switch still
// grants what was paid for.
const LEGACY_TRIAL_HOURS = { '24h': 24, '7d': 24 * 7 };

const PRICES_EUR = {
  standard: { 1: 9.99, 3: 24.99, 6: 34.99, 12: 45.99 },
  premium: { 1: 10.99, 3: 27.99, 6: 38.99, 12: 49.99 },
  premiumplus: { 1: 11.99, 3: 32.99, 6: 48.99, 12: 64.99 },
  vip: { 1: 15.99, 3: 44.99, 6: 69.99, 12: 99.99 },
};

const CATEGORY_LIMITS = {
  trial: { label: 'Trial', maxProducts: 5, checkEveryMinutes: 360 },
  standard: { label: 'Standard', maxProducts: 10, checkEveryMinutes: 360 },
  premium: { label: 'Premium', maxProducts: 50, checkEveryMinutes: 60 },
  premiumplus: { label: 'Premium Plus', maxProducts: 200, checkEveryMinutes: 15 },
  vip: { label: 'VIP', maxProducts: Infinity, checkEveryMinutes: 15 },
};

function isValidCombo(category, months, users = 1) {
  return CATEGORIES.indexOf(category) !== -1
    && Object.prototype.hasOwnProperty.call(PRICES_EUR[category] || {}, months)
    && USERS.indexOf(users) !== -1;
}

// null for an unknown category, 0 for a free trial.
function trialPriceFor(category) {
  return CATEGORIES.indexOf(category) === -1 ? null : TRIAL_PRICES_EUR[category];
}

// Integer cents, rounded half up — frontend/js/pricing.js mirrors this exactly.
function priceFor(category, months, users = 1) {
  if (!isValidCombo(category, months, users)) return null;
  const cents = Math.round(PRICES_EUR[category][months] * 100);
  return Math.floor((cents * USER_PRICE_PCT[users] + 50) / 100) / 100;
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
  USERS,
  PRICES_EUR,
  CATEGORY_LIMITS,
  TRIAL_HOURS,
  TRIAL_PRICES_EUR,
  LEGACY_TRIAL_HOURS,
  isValidCombo,
  trialPriceFor,
  priceFor,
  getCategoryLimits,
  envKey,
};

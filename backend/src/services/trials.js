const db = require('../db');
const { CATEGORIES, TRIAL_HOURS, LEGACY_TRIAL_HOURS } = require('../utils/pricing');

// One trial per account: only an account that has never had a trial or an active plan.
const TRIAL_ELIGIBLE_SQL = `plan_status = 'pending_payment' AND trial_expires_at IS NULL`;

async function isTrialEligible(userId) {
  const result = await db.query(`SELECT 1 FROM users WHERE id = $1 AND ${TRIAL_ELIGIBLE_SQL}`, [userId]);
  return result.rows.length > 0;
}

// Gives the account `category`'s full limits for TRIAL_HOURS. The trial ends through
// plan_expires_at, the same expiry products.js and the scheduler already enforce for
// one-time Polar plans. Returns false if the account wasn't eligible (nothing changed).
async function grantTrial(userId, category) {
  const result = await db.query(
    `UPDATE users
     SET plan_tier = $1,
         plan_duration_months = NULL,
         plan_users = 1,
         plan_status = 'active',
         trial_type = '24h',
         trial_expires_at = now() + make_interval(hours => $2),
         plan_expires_at = now() + make_interval(hours => $2)
     WHERE id = $3 AND ${TRIAL_ELIGIBLE_SQL}`,
    [category, TRIAL_HOURS, userId]
  );
  return result.rowCount > 0;
}

// Called by the payment webhooks once a paid trial checkout completes.
async function applyPaidTrial({ userId, category, trialType }, source) {
  if (category) {
    if (CATEGORIES.indexOf(category) === -1) {
      console.error(`[${source}] paid trial with unknown category:`, category);
    } else if (!(await grantTrial(userId, category))) {
      console.error(`[${source}] paid trial for user ${userId}, but the account had already used its trial or has a plan`);
    }
    return;
  }

  const legacyHours = LEGACY_TRIAL_HOURS[trialType];
  if (!legacyHours) {
    console.error(`[${source}] paid trial with unknown trialType:`, trialType);
    return;
  }
  await db.query(
    `UPDATE users SET plan_status = 'active', trial_expires_at = now() + make_interval(hours => $1), trial_type = $2 WHERE id = $3`,
    [legacyHours, trialType, userId]
  );
}

module.exports = { isTrialEligible, grantTrial, applyPaidTrial };

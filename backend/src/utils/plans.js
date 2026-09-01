// Plan tier configuration: product limits + scrape frequency (minutes)
const PLANS = {
  trial: { label: 'Trial', maxProducts: 5, checkEveryMinutes: 360, price: 0 },
  starter: { label: 'Starter', maxProducts: 10, checkEveryMinutes: 360, price: 15 },
  growth: { label: 'Growth', maxProducts: 50, checkEveryMinutes: 60, price: 39 },
  pro: { label: 'Pro', maxProducts: 200, checkEveryMinutes: 15, price: 89 },
  agency: { label: 'Agency', maxProducts: Infinity, checkEveryMinutes: 15, price: 199 },
};

function getPlan(tier) {
  return PLANS[tier] || PLANS.trial;
}

module.exports = { PLANS, getPlan };

// Feature limits by subscription category. Pricing itself lives in ./pricing.js —
// this module only answers "what does this category unlock" (product limit + scrape
// frequency), used by the scheduler and the product-limit gate.
const { getCategoryLimits } = require('./pricing');

function getPlan(tier) {
  return getCategoryLimits(tier);
}

module.exports = { getPlan };

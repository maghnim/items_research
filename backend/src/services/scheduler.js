const cron = require('node-cron');
const db = require('../db');
const { scrapeProduct } = require('./scraper');
const { evaluateAndAlert } = require('./alerts');
const { getPlan } = require('../utils/plans');

async function checkOneProduct(product) {
  const result = await scrapeProduct(product);

  if (!result.success) {
    await db.query(
      `INSERT INTO scrape_jobs (product_id, status, error_message) VALUES ($1, 'failed', $2)`,
      [product.id, result.error]
    );
    return;
  }

  await evaluateAndAlert(product, result);

  await db.query(
    `INSERT INTO price_history (product_id, price, currency, in_stock) VALUES ($1, $2, $3, $4)`,
    [product.id, result.price, result.currency, result.inStock]
  );

  await db.query(
    `UPDATE tracked_products
     SET last_price = $1, last_in_stock = $2, last_checked_at = now()
     WHERE id = $3`,
    [result.price, result.inStock, product.id]
  );

  await db.query(
    `INSERT INTO scrape_jobs (product_id, status) VALUES ($1, 'success')`,
    [product.id]
  );
}

// Runs every 5 minutes; picks up any product whose plan-based interval has elapsed.
async function runDueScrapes() {
  const { rows: products } = await db.query(`
    SELECT tp.*, u.plan_tier
    FROM tracked_products tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.is_active = true
      AND u.plan_status = 'active'
  `);

  const due = products.filter((p) => {
    const plan = getPlan(p.plan_tier);
    if (!p.last_checked_at) return true;
    const minutesSince = (Date.now() - new Date(p.last_checked_at).getTime()) / 60000;
    return minutesSince >= plan.checkEveryMinutes;
  });

  for (const product of due) {
    try {
      await checkOneProduct(product);
    } catch (err) {
      console.error(`[scheduler] failed to check product ${product.id}:`, err.message);
    }
  }

  if (due.length > 0) {
    console.log(`[scheduler] checked ${due.length} product(s)`);
  }
}

function startScheduler() {
  cron.schedule('*/5 * * * *', () => {
    runDueScrapes().catch((err) => console.error('[scheduler] run failed:', err));
  });
  console.log('[scheduler] started (every 5 minutes)');
}

module.exports = { startScheduler, runDueScrapes, checkOneProduct };

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getPlan } = require('../utils/plans');
const { checkOneProduct } = require('../services/scheduler');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await db.query(
    `SELECT * FROM tracked_products WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );
  res.json({ products: result.rows });
});

router.post('/', async (req, res) => {
  const { url, nickname, competitor_name, platform, price_selector, alert_threshold_pct, currency } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Product URL is required.' });
  }

  const userResult = await db.query('SELECT plan_tier FROM users WHERE id = $1', [req.userId]);
  const plan = getPlan(userResult.rows[0]?.plan_tier);

  const countResult = await db.query(
    'SELECT COUNT(*) FROM tracked_products WHERE user_id = $1 AND is_active = true',
    [req.userId]
  );
  const currentCount = Number(countResult.rows[0].count);

  if (currentCount >= plan.maxProducts) {
    return res.status(403).json({
      error: `Your ${plan.label} plan allows up to ${plan.maxProducts} tracked products. Upgrade to add more.`,
    });
  }

  const result = await db.query(
    `INSERT INTO tracked_products (user_id, url, nickname, competitor_name, platform, price_selector, alert_threshold_pct, currency_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.userId, url, nickname || null, competitor_name || null, platform || 'auto', price_selector || null, alert_threshold_pct || 0, currency || 'USD']
  );

  const product = result.rows[0];

  // Kick off an immediate first check so the user sees data right away.
  checkOneProduct(product).catch((err) => console.error('[products] initial check failed:', err.message));

  res.status(201).json({ product });
});

router.get('/:id/history', async (req, res) => {
  const owned = await db.query('SELECT id FROM tracked_products WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (owned.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const history = await db.query(
    `SELECT price, currency, in_stock, scraped_at FROM price_history
     WHERE product_id = $1 ORDER BY scraped_at ASC LIMIT 500`,
    [req.params.id]
  );
  res.json({ history: history.rows });
});

router.patch('/:id', async (req, res) => {
  const { nickname, is_active, alert_threshold_pct, price_selector } = req.body;
  const result = await db.query(
    `UPDATE tracked_products
     SET nickname = COALESCE($1, nickname),
         is_active = COALESCE($2, is_active),
         alert_threshold_pct = COALESCE($3, alert_threshold_pct),
         price_selector = COALESCE($4, price_selector)
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [nickname, is_active, alert_threshold_pct, price_selector, req.params.id, req.userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  res.json({ product: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  const result = await db.query(
    'DELETE FROM tracked_products WHERE id = $1 AND user_id = $2 RETURNING id',
    [req.params.id, req.userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  res.status(204).send();
});

module.exports = router;

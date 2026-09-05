const db = require('../db');
const { sendAlertEmail } = require('./mailer');
const { formatAmount } = require('../utils/currency');

function pctChange(oldPrice, newPrice) {
  if (!oldPrice) return Infinity;
  return Math.abs((newPrice - oldPrice) / oldPrice) * 100;
}

async function evaluateAndAlert(product, scrapeResult) {
  const previousPrice = product.last_price !== null ? Number(product.last_price) : null;
  const newPrice = scrapeResult.price;
  const currency = scrapeResult.currency || product.last_currency || 'USD';
  const previousStock = product.last_in_stock;
  const newStock = scrapeResult.inStock;

  const events = [];

  if (previousPrice !== null && newPrice !== previousPrice) {
    const change = pctChange(previousPrice, newPrice);
    if (change >= Number(product.alert_threshold_pct || 0)) {
      events.push({
        type: newPrice < previousPrice ? 'price_drop' : 'price_increase',
        oldPrice: previousPrice,
        newPrice,
        currency,
      });
    }
  }

  if (previousStock === false && newStock === true) {
    events.push({ type: 'back_in_stock', oldPrice: previousPrice, newPrice, currency });
  } else if (previousStock === true && newStock === false) {
    events.push({ type: 'out_of_stock', oldPrice: previousPrice, newPrice, currency });
  }

  for (const event of events) {
    await db.query(
      `INSERT INTO alerts_log (product_id, alert_type, old_price, new_price, channel)
       VALUES ($1, $2, $3, $4, 'email')`,
      [product.id, event.type, event.oldPrice, event.newPrice]
    );

    const userResult = await db.query('SELECT email FROM users WHERE id = $1', [product.user_id]);
    const email = userResult.rows[0]?.email;
    if (email) {
      try {
        await sendAlertEmail({
          to: email,
          subject: alertSubject(event, product),
          html: alertHtml(event, product),
        });
      } catch (err) {
        // A failed send (bad key, sandbox recipient restriction, provider outage) shouldn't
        // fail the price check itself — the alert is already recorded in alerts_log either way.
        console.error(`[alerts] email send failed for product ${product.id}:`, err.message);
      }
    }
  }

  return events;
}

function alertSubject(event, product) {
  const name = product.nickname || product.competitor_name || product.url;
  const price = formatAmount(event.newPrice, event.currency);
  switch (event.type) {
    case 'price_drop':
      return `Price drop: ${name} is now ${price}`;
    case 'price_increase':
      return `Price increase: ${name} is now ${price}`;
    case 'back_in_stock':
      return `Back in stock: ${name}`;
    case 'out_of_stock':
      return `Out of stock: ${name}`;
    default:
      return `Update for ${name}`;
  }
}

function alertHtml(event, product) {
  const name = product.nickname || product.competitor_name || product.url;
  return `
    <div style="font-family: Arial, sans-serif; color: #0F172A;">
      <h2 style="color:#2563EB;">Pricera Alert</h2>
      <p><strong>${name}</strong></p>
      <p>${alertSubject(event, product)}</p>
      ${event.oldPrice ? `<p>Previous price: ${formatAmount(event.oldPrice, event.currency)}</p>` : ''}
      <p><a href="${product.url}" style="color:#2563EB;">View product</a></p>
    </div>
  `;
}

module.exports = { evaluateAndAlert };

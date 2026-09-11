const { Polar } = require('@polar-sh/sdk');

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN || 'polar_oat_placeholder',
  server: process.env.POLAR_MODE === 'production' ? 'production' : 'sandbox',
});

// Polar has no Stripe-style "bill every N months" recurring interval, so every Pricera
// checkout via Polar (trial unlock and paid plans alike) is a one-time payment for an
// amount computed from our own pricing tables and handed to Polar per-checkout via the
// `prices` ad-hoc override — no per-combo Product/Price needs to pre-exist in Polar.
async function createDynamicCheckout({ productId, amountEur, currency = 'eur', successUrl, customerEmail, metadata, locale }) {
  const priceAmount = Math.round(amountEur * 100);
  return polar.checkouts.create({
    products: [productId],
    prices: {
      [productId]: [{ amountType: 'fixed', priceAmount, priceCurrency: currency }],
    },
    successUrl,
    customerEmail,
    metadata,
    locale: locale || undefined,
  });
}

module.exports = { polar, createDynamicCheckout };

// Pre-built CSS selector templates for common e-commerce platforms.
// Used as a fallback chain when a user doesn't supply a custom selector.

const PLATFORM_SELECTORS = {
  shopify: {
    price: [
      '[data-product-price]',
      '.price-item--regular',
      '.product__price',
      'meta[property="product:price:amount"]',
    ],
    stock: ['[data-stock-status]', '.product-form__inventory'],
  },
  woocommerce: {
    price: ['p.price span.woocommerce-Price-amount bdi', 'p.price ins span.woocommerce-Price-amount'],
    stock: ['.stock'],
  },
  amazon: {
    price: ['#corePrice_feature_div .a-offscreen', '#priceblock_ourprice', '.a-price .a-offscreen'],
    stock: ['#availability span'],
  },
  generic: {
    price: [
      '[itemprop="price"]',
      'meta[property="og:price:amount"]',
      '.price',
      '#price',
      '.product-price',
    ],
    stock: ['.availability', '.in-stock', '.out-of-stock'],
  },
};

function detectPlatform(html) {
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return 'shopify';
  if (/woocommerce/i.test(html)) return 'woocommerce';
  if (/amazon\.[a-z.]+/i.test(html)) return 'amazon';
  return 'generic';
}

function selectorsFor(platform) {
  return PLATFORM_SELECTORS[platform] || PLATFORM_SELECTORS.generic;
}

module.exports = { PLATFORM_SELECTORS, detectPlatform, selectorsFor };

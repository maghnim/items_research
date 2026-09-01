const axios = require('axios');
const cheerio = require('cheerio');
const { detectPlatform, selectorsFor } = require('../utils/selectors');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9.,]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function extractWithCheerio(html, product) {
  const $ = cheerio.load(html);
  const platform = product.platform && product.platform !== 'auto' ? product.platform : detectPlatform(html);
  const candidates = [];

  if (product.price_selector) candidates.push(product.price_selector);
  candidates.push(...selectorsFor(platform).price);

  for (const selector of candidates) {
    const el = $(selector).first();
    if (el.length) {
      const raw = el.attr('content') || el.text();
      const price = parsePrice(raw);
      if (price !== null) {
        return { price, platform, selectorUsed: selector };
      }
    }
  }
  return { price: null, platform, selectorUsed: null };
}

async function fetchStaticHtml(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': pickUserAgent(),
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15000,
  });
  return response.data;
}

// Fallback for JS-rendered storefronts. Requires `npx playwright install chromium` once.
async function fetchRenderedHtml(url) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: pickUserAgent() });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function scrapeProduct(product) {
  let html;
  try {
    html = await fetchStaticHtml(product.url);
  } catch (err) {
    return { success: false, error: `Static fetch failed: ${err.message}` };
  }

  let result = extractWithCheerio(html, product);

  if (result.price === null) {
    try {
      html = await fetchRenderedHtml(product.url);
      result = extractWithCheerio(html, product);
    } catch (err) {
      return { success: false, error: `Price element not found (headless fallback failed: ${err.message})` };
    }
  }

  if (result.price === null) {
    return { success: false, error: 'Price element not found with any known selector.' };
  }

  return {
    success: true,
    price: result.price,
    currency: product.currency_default || 'USD',
    platform: result.platform,
    selectorUsed: result.selectorUsed,
    inStock: true,
  };
}

module.exports = { scrapeProduct, parsePrice };

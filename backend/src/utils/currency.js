// Currency detection + display helpers.
// We try, in order: an explicit page signal (meta/itemprop tag with an ISO code),
// then a symbol/code found in the raw price text, then fall back to the user's
// manual override, then USD.

const SYMBOL_TO_CODE = [
  [/MAD|DH\b|درهم|د\.م/i, 'MAD'],
  [/€|EUR\b/i, 'EUR'],
  [/£|GBP\b/i, 'GBP'],
  [/¥|JPY\b/i, 'JPY'],
  [/CHF/i, 'CHF'],
  [/CAD\b|C\$/i, 'CAD'],
  [/AUD\b|A\$/i, 'AUD'],
  [/\$|USD\b/i, 'USD'],
];

const CODE_TO_SYMBOL = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  MAD: 'DH',
  JPY: '¥',
  CHF: 'CHF',
  CAD: 'CA$',
  AUD: 'A$',
};

function detectCurrencyFromPage($) {
  const metaContent = $('meta[property="product:price:currency"]').attr('content')
    || $('meta[property="og:price:currency"]').attr('content')
    || $('[itemprop="priceCurrency"]').attr('content')
    || $('[itemprop="priceCurrency"]').attr('data-currency');
  if (metaContent) {
    const code = metaContent.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) return code;
  }
  return null;
}

function detectCurrencyFromText(text) {
  if (!text) return null;
  for (const [pattern, code] of SYMBOL_TO_CODE) {
    if (pattern.test(text)) return code;
  }
  return null;
}

function symbolFor(code) {
  return CODE_TO_SYMBOL[code] || `${code} `;
}

function formatAmount(amount, code) {
  const symbol = symbolFor(code || 'USD');
  const value = Number(amount).toFixed(2);
  // Symbols that read naturally after the number (e.g. "120.00 DH") vs before ("$120.00").
  return ['MAD'].includes(code) ? `${value} ${symbol}` : `${symbol}${value}`;
}

module.exports = { detectCurrencyFromPage, detectCurrencyFromText, symbolFor, formatAmount };

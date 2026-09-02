// Mirrors backend/src/utils/pricing.js — EUR is the source of truth for both display
// (converted to USD for English-speaking visitors) and actual billing.
const PRICING = {
  standard: { 1: 9.99, 3: 19.99, 6: 29.99, 12: 45.99 },
  premium: { 1: 10.99, 3: 25.99, 6: 39.99, 12: 49.99 },
  premiumplus: { 1: 11.99, 3: 28.99, 6: 45.99, 12: 64.99 },
  vip: { 1: 15.99, 3: 34.99, 6: 59.99, 12: 99.99 },
};

const CATEGORIES = ['standard', 'premium', 'premiumplus', 'vip'];
const DURATIONS = [1, 3, 6, 12];
const DEFAULT_CATEGORY = 'premium';

// Static demo FX rate — swap for a live rate lookup before charging real USD anywhere.
const EUR_TO_USD = 1.08;

let activeCategory = DEFAULT_CATEGORY;

function formatMoney(amount, currency) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${amount.toFixed(2)}`;
}

function renderPricingTable() {
  const currency = (window.getCurrency && window.getCurrency()) || 'EUR';
  const prices = PRICING[activeCategory];
  const baseRate = prices[1]; // 1-month price = reference rate for the savings %

  document.querySelectorAll('.pricing-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-category') === activeCategory);
  });

  const metaEl = document.getElementById('pricing-meta');
  if (metaEl) metaEl.textContent = t(`pricing.meta.${activeCategory}`);

  const tbody = document.getElementById('pricing-tbody');
  if (!tbody) return;

  tbody.innerHTML = DURATIONS.map((months) => {
    const eurPrice = prices[months];
    const displayTotal = currency === 'USD' ? eurPrice * EUR_TO_USD : eurPrice;
    const perMonth = displayTotal / months;
    const savingsPct = Math.round((1 - (eurPrice / months) / baseRate) * 100);
    const isBest = months === 12;

    return `
      <tr class="${isBest ? 'pricing-row-best' : ''}">
        <td>
          ${t(`pricing.term.${months}`)}
          ${isBest ? `<span class="badge-best">${t('pricing.badge.bestvalue')}</span>` : ''}
        </td>
        <td class="price-cell">${formatMoney(displayTotal, currency)}</td>
        <td>${formatMoney(perMonth, currency)} <span class="permonth-suffix">${t('common.perMonth')}</span></td>
        <td>${savingsPct > 0 ? `<span class="savings-pill">-${savingsPct}%</span>` : '—'}</td>
        <td><button class="btn btn-primary btn-sm" onclick="startStripeCheckout('${activeCategory}', ${months})">${t('pricing.table.action')}</button></td>
      </tr>
    `;
  }).join('');

  const usdNote = document.getElementById('pricing-usd-note');
  if (usdNote) usdNote.style.display = currency === 'USD' ? 'block' : 'none';
}

function selectCategory(category) {
  if (CATEGORIES.indexOf(category) === -1) return;
  activeCategory = category;
  renderPricingTable();
}

document.querySelectorAll('.pricing-tab').forEach((tab) => {
  tab.addEventListener('click', () => selectCategory(tab.getAttribute('data-category')));
});

window.addEventListener('pp:locale-ready', renderPricingTable);

renderPricingTable();

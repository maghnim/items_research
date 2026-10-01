// Mirrors backend/src/utils/pricing.js — EUR is the source of truth for both display
// (converted to USD for English-speaking visitors) and actual billing.
const PRICING = {
  standard: { 1: 9.99, 3: 24.99, 6: 34.99, 12: 45.99 },
  premium: { 1: 10.99, 3: 27.99, 6: 38.99, 12: 49.99 },
  premiumplus: { 1: 11.99, 3: 32.99, 6: 48.99, 12: 64.99 },
  vip: { 1: 15.99, 3: 44.99, 6: 69.99, 12: 99.99 },
};

// Mirrors USER_PRICE_PCT / priceFor() in backend/src/utils/pricing.js: extra users at a
// growing discount (-10% / -15% / -20%), computed in integer cents, rounded half up.
const USER_PRICE_PCT = { 1: 100, 2: 180, 3: 255, 4: 320 };

function planPrice(category, months, users) {
  const cents = Math.round(PRICING[category][months] * 100);
  return Math.floor((cents * USER_PRICE_PCT[users] + 50) / 100) / 100;
}

// Mirrors TRIAL_PRICES_EUR in backend/src/utils/pricing.js: a 24-hour trial per plan.
const TRIAL_PRICES_EUR = { standard: 0, premium: 0, premiumplus: 0, vip: 2.99 };

const CATEGORIES = ['standard', 'premium', 'premiumplus', 'vip'];
const DURATIONS = [1, 3, 6, 12];
const DEFAULT_CATEGORY = 'premium';

// Static demo FX rate — swap for a live rate lookup before charging real USD anywhere.
const EUR_TO_USD = 1.08;

let activeCategory = DEFAULT_CATEGORY;
let activeUsers = 1;
// The Stripe button only shows once the backend reports Stripe is set up (GET /billing/providers).
let stripeEnabled = false;

function formatMoney(amount, currency) {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${amount.toFixed(2)}`;
}

function renderPricingTable() {
  const currency = (window.getCurrency && window.getCurrency()) || 'EUR';
  const baseRate = planPrice(activeCategory, 1, activeUsers); // 1-month price = reference for the savings %

  document.querySelectorAll('.pricing-tab[data-category]').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-category') === activeCategory);
  });
  document.querySelectorAll('.pricing-tab[data-users]').forEach((tab) => {
    tab.classList.toggle('active', Number(tab.getAttribute('data-users')) === activeUsers);
  });

  const usersNoteEl = document.getElementById('pricing-users-note');
  if (usersNoteEl) {
    usersNoteEl.textContent = activeUsers > 1 ? t('pricing.users.pricefor').replace('{n}', activeUsers) : '';
  }
  // Stripe has prices for 1 user only; multi-user plans are paid through Polar.
  const showStripe = stripeEnabled && activeUsers === 1;
  const usersParam = activeUsers > 1 ? `&users=${activeUsers}` : '';

  const metaEl = document.getElementById('pricing-meta');
  if (metaEl) metaEl.textContent = t(`pricing.meta.${activeCategory}`);

  const tbody = document.getElementById('pricing-tbody');
  if (!tbody) return;

  tbody.innerHTML = DURATIONS.map((months) => {
    const eurPrice = planPrice(activeCategory, months, activeUsers);
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
        <td>
          ${showStripe ? `<a class="btn btn-primary btn-sm" href="checkout.html?plan=${activeCategory}&months=${months}&provider=stripe">${t('pricing.table.action')}</a>` : ''}
          <a class="btn btn-outline btn-sm" href="checkout.html?plan=${activeCategory}&months=${months}${usersParam}">${t('pricing.table.action.polar')}</a>
        </td>
      </tr>
    `;
  }).join('');

  const trialEl = document.getElementById('pricing-trial');
  if (trialEl) {
    const trialPrice = TRIAL_PRICES_EUR[activeCategory];
    const plan = t(`pricing.cat.${activeCategory}`);
    trialEl.href = `checkout.html?plan=${activeCategory}&trial=24h`;
    trialEl.textContent = trialPrice === 0
      ? t('pricing.trial.free').replace('{plan}', plan)
      : t('pricing.trial.paid').replace('{plan}', plan)
        .replace('{price}', formatMoney(currency === 'USD' ? trialPrice * EUR_TO_USD : trialPrice, currency));
  }

  const usdNote = document.getElementById('pricing-usd-note');
  if (usdNote) usdNote.style.display = currency === 'USD' ? 'block' : 'none';
}

function selectCategory(category) {
  if (CATEGORIES.indexOf(category) === -1) return;
  activeCategory = category;
  renderPricingTable();
}

function selectUsers(users) {
  if (!USER_PRICE_PCT[users]) return;
  activeUsers = users;
  renderPricingTable();
}

document.querySelectorAll('.pricing-tab[data-category]').forEach((tab) => {
  tab.addEventListener('click', () => selectCategory(tab.getAttribute('data-category')));
});
document.querySelectorAll('.pricing-tab[data-users]').forEach((tab) => {
  tab.addEventListener('click', () => selectUsers(Number(tab.getAttribute('data-users'))));
});

window.addEventListener('pp:locale-ready', renderPricingTable);

renderPricingTable();

api('/billing/providers')
  .then((providers) => {
    stripeEnabled = !!providers.stripe;
    if (stripeEnabled) renderPricingTable();
  })
  .catch(() => { /* keep Polar only */ });

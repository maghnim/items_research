requireAuthOrRedirect();

const CATEGORY_LABELS = {
  standard: 'Standard',
  premium: 'Premium',
  premiumplus: 'Premium Plus',
  vip: 'VIP',
};

function formatMoney(amount, currency) {
  const symbol = (currency || 'eur').toUpperCase() === 'USD' ? '$' : '€';
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function itemLabel(metadata) {
  if (metadata.type === 'trial') {
    return t(metadata.trialType === '7d' ? 'payment.item.trial7d' : 'payment.item.trial24h');
  }
  const category = CATEGORY_LABELS[metadata.category] || metadata.category;
  return t('payment.item.plan').replace('{category}', category).replace('{months}', metadata.months);
}

function addRow(tbody, label, value) {
  const tr = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.style.cssText = 'padding:10px 0; color:var(--slate-500); border-bottom:1px solid var(--slate-200);';
  tdLabel.textContent = label;
  const tdValue = document.createElement('td');
  tdValue.style.cssText = 'padding:10px 0; text-align:right; border-bottom:1px solid var(--slate-200); font-weight:600;';
  tdValue.textContent = value;
  tr.appendChild(tdLabel);
  tr.appendChild(tdValue);
  tbody.appendChild(tr);
}

async function loadPaymentDetails() {
  const params = new URLSearchParams(window.location.search);
  const checkoutId = params.get('checkout_id');
  const loadingEl = document.getElementById('payment-loading');
  const errorEl = document.getElementById('payment-error');
  const successEl = document.getElementById('payment-success');

  if (!checkoutId) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const checkout = await api(`/billing/polar/checkout/${checkoutId}`);
    if (checkout.status !== 'succeeded') {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      return;
    }

    const tbody = document.getElementById('payment-details');
    addRow(tbody, t('payment.success.item'), itemLabel(checkout.metadata || {}));
    addRow(tbody, t('payment.success.amount'), formatMoney(checkout.amount, checkout.currency));
    if (checkout.customerName) addRow(tbody, t('payment.success.buyer'), checkout.customerName);
    addRow(tbody, t('payment.success.email'), checkout.customerEmail || '—');
    addRow(tbody, t('payment.success.date'), new Date(checkout.createdAt).toLocaleString());
    addRow(tbody, t('payment.success.reference'), checkoutId);

    loadingEl.style.display = 'none';
    successEl.style.display = 'block';
  } catch (err) {
    console.error('Failed to load payment details:', err.message);
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
  }
}

loadPaymentDetails();

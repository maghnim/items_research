// Not gated by requireAuthOrRedirect() — a guest who paid without an account first
// legitimately has no token yet, and still needs to see this page to claim it.

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

function showReceipt(checkout) {
  const tbody = document.getElementById('payment-details');
  addRow(tbody, t('payment.success.item'), itemLabel(checkout.metadata || {}));
  addRow(tbody, t('payment.success.amount'), formatMoney(checkout.amount, checkout.currency));
  if (checkout.customerName) addRow(tbody, t('payment.success.buyer'), checkout.customerName);
  addRow(tbody, t('payment.success.email'), checkout.customerEmail || '—');
  addRow(tbody, t('payment.success.date'), new Date(checkout.createdAt).toLocaleString());
  addRow(tbody, t('payment.success.reference'), checkoutIdFromUrl());

  document.getElementById('payment-loading').style.display = 'none';
  document.getElementById('payment-success').style.display = 'block';
}

function showClaimForm(checkout, checkoutId) {
  document.getElementById('claim-email').value = checkout.customerEmail || '';
  document.getElementById('payment-loading').style.display = 'none';
  document.getElementById('payment-claim').style.display = 'block';

  const form = document.getElementById('claim-form');
  const errorEl = document.getElementById('claim-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const password = document.getElementById('claim-password').value;
    const confirm = document.getElementById('claim-password-confirm').value;
    if (password.length < 8) {
      errorEl.textContent = t('payment.claim.tooShort');
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = t('payment.claim.mismatch');
      return;
    }

    try {
      const { token, user } = await api('/billing/polar/claim-account', {
        method: 'POST',
        body: { checkoutId, password },
      });
      setToken(token);
      setUser(user);
      window.location.href = 'dashboard.html';
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function showError() {
  document.getElementById('payment-loading').style.display = 'none';
  document.getElementById('payment-error').style.display = 'block';
}

function checkoutIdFromUrl() {
  return new URLSearchParams(window.location.search).get('checkout_id');
}

async function loadPaymentDetails(attempt) {
  const checkoutId = checkoutIdFromUrl();
  if (!checkoutId) {
    showError();
    return;
  }

  let checkout;
  try {
    checkout = await api(`/billing/polar/checkout/${checkoutId}`);
  } catch (err) {
    console.error('Failed to load payment details:', err.message);
    showError();
    return;
  }

  if (checkout.status !== 'succeeded') {
    showError();
    return;
  }

  if (checkout.needsPasswordSetup) {
    showClaimForm(checkout, checkoutId);
    return;
  }

  // Guest checkout, paid, but the account-creation webhook may not have landed yet —
  // retry briefly rather than flashing the wrong state.
  const isGuestCheckout = checkout.metadata?.guest === 'true';
  if (isGuestCheckout && (attempt || 0) < 5) {
    setTimeout(() => loadPaymentDetails((attempt || 0) + 1), 2000);
    return;
  }

  showReceipt(checkout);
}

loadPaymentDetails(0);

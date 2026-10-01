// Permanent, shareable checkout links — safe to use as buttons or redirects anywhere:
//   checkout.html?plan=vip&months=12                  pays with Polar, no account needed
//   checkout.html?plan=vip&months=12&users=3          same, for 3 users (1-4, default 1)
//   checkout.html?plan=vip&months=12&provider=stripe  Stripe, signs up / logs in first
//                                                     (Polar while Stripe isn't set up)
//   checkout.html?plan=premium&trial=24h              24-hour trial of that plan
// Every visit creates a fresh checkout session, so the link itself never expires.

const CHECKOUT_PLANS = ['standard', 'premium', 'premiumplus', 'vip'];
const CHECKOUT_TERMS = [1, 3, 6, 12];
const CHECKOUT_USERS = [1, 2, 3, 4];
// Mirrors TRIAL_PRICES_EUR in backend/src/utils/pricing.js.
const TRIAL_PRICES_EUR = { standard: 0, premium: 0, premiumplus: 0, vip: 2.99 };

function showCheckoutError(text) {
  document.getElementById('checkout-status').style.display = 'none';
  document.getElementById('checkout-spinner').style.display = 'none';
  const msg = document.getElementById('form-msg');
  msg.textContent = text;
  msg.className = 'form-msg error';
  document.getElementById('checkout-back').style.display = 'block';
}

// Trials and Stripe need an account; come back to this same link afterwards.
function sendToAuth(page) {
  window.location.href = `${page}?next=${encodeURIComponent('checkout.html' + window.location.search)}`;
}

async function startCheckout() {
  // The inline fast path in checkout.html is already sending this visitor to Polar.
  if (window.checkoutRedirecting) return;
  const params = new URLSearchParams(window.location.search);
  const plan = params.get('plan');
  const months = Number(params.get('months'));
  const users = Number(params.get('users') || 1);
  const isTrial = params.get('trial') === '24h';
  let provider = params.get('provider') === 'stripe' ? 'stripe' : 'polar';
  const locale = document.documentElement.getAttribute('lang') || 'en';

  if (CHECKOUT_PLANS.indexOf(plan) === -1
    || (!isTrial && (CHECKOUT_TERMS.indexOf(months) === -1 || CHECKOUT_USERS.indexOf(users) === -1))) {
    showCheckoutError(t('checkout.error.invalid'));
    return;
  }
  // Stripe has 1-user prices only, so multi-user plans always go through Polar.
  if (users > 1) provider = 'polar';
  // A Stripe link keeps working while Stripe isn't set up: it falls back to Polar.
  if (provider === 'stripe') {
    try {
      if (!(await api('/billing/providers')).stripe) provider = 'polar';
    } catch (_) {
      provider = 'polar';
    }
  }
  if ((isTrial || provider === 'stripe') && !getToken()) {
    sendToAuth('signup.html');
    return;
  }

  try {
    if (isTrial && TRIAL_PRICES_EUR[plan] === 0) {
      await api('/billing/trial/start', { method: 'POST', body: { category: plan } });
      window.location.href = 'dashboard.html?checkout=trial-started';
      return;
    }

    let path;
    let body;
    if (isTrial) {
      path = `/billing/${provider}/create-trial-checkout-session`;
      body = { category: plan, locale };
    } else {
      path = `/billing/${provider}/create-checkout-session`;
      body = { category: plan, months, users, locale };
    }
    const { url } = await api(path, { method: 'POST', body });
    window.location.href = url;
  } catch (err) {
    if (err.status === 401) {
      // Saved login expired — log in again, then come straight back here.
      clearToken();
      sendToAuth('login.html');
      return;
    }
    showCheckoutError(err.message);
  }
}

startCheckout();

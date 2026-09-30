// Permanent, shareable checkout links — safe to use as buttons or redirects anywhere:
//   checkout.html?plan=vip&months=12                  pays with Polar, no account needed
//   checkout.html?plan=vip&months=12&provider=stripe  Stripe, signs up / logs in first
//   checkout.html?plan=premium&trial=24h              24-hour trial of that plan
// Every visit creates a fresh checkout session, so the link itself never expires.

const CHECKOUT_PLANS = ['standard', 'premium', 'premiumplus', 'vip'];
const CHECKOUT_TERMS = [1, 3, 6, 12];
// Mirrors TRIAL_PRICES_EUR in backend/src/utils/pricing.js.
const TRIAL_PRICES_EUR = { standard: 0, premium: 0, premiumplus: 0, vip: 2.99 };

function showCheckoutError(text) {
  document.getElementById('checkout-status').style.display = 'none';
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
  const params = new URLSearchParams(window.location.search);
  const plan = params.get('plan');
  const months = Number(params.get('months'));
  const isTrial = params.get('trial') === '24h';
  const provider = params.get('provider') === 'stripe' ? 'stripe' : 'polar';
  const locale = document.documentElement.getAttribute('lang') || 'en';

  if (CHECKOUT_PLANS.indexOf(plan) === -1 || (!isTrial && CHECKOUT_TERMS.indexOf(months) === -1)) {
    showCheckoutError(t('checkout.error.invalid'));
    return;
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
      body = { category: plan, months, locale };
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

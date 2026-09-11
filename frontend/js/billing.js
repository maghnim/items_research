async function startStripeCheckout(category, months) {
  if (!getToken()) {
    window.location.href = `signup.html?plan=${category}&months=${months}`;
    return;
  }
  try {
    const { url } = await api('/billing/stripe/create-checkout-session', { method: 'POST', body: { category, months } });
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

async function startTrialCheckout(trialType) {
  try {
    const { url } = await api('/billing/stripe/create-trial-checkout-session', { method: 'POST', body: { trialType } });
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

function currentLocale() {
  return document.documentElement.getAttribute('lang') || 'en';
}

async function startPolarCheckout(category, months) {
  // Unlike Stripe, Polar plan checkout doesn't require an account first — the backend
  // (optionalAuth) treats a missing token as a guest checkout and auto-creates the
  // account from the Polar order once payment succeeds (see routes/billing.js).
  try {
    const { url } = await api('/billing/polar/create-checkout-session', { method: 'POST', body: { category, months, locale: currentLocale() } });
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

async function startPolarTrialCheckout(trialType) {
  try {
    const { url } = await api('/billing/polar/create-trial-checkout-session', { method: 'POST', body: { trialType, locale: currentLocale() } });
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

async function openBillingPortal() {
  try {
    const { url } = await api('/billing/stripe/portal');
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

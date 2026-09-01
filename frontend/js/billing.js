async function startStripeCheckout(tier) {
  if (!getToken()) {
    window.location.href = `signup.html?plan=${tier}`;
    return;
  }
  try {
    const { url } = await api('/billing/stripe/create-checkout-session', { method: 'POST', body: { tier } });
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

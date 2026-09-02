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

async function openBillingPortal() {
  try {
    const { url } = await api('/billing/stripe/portal');
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

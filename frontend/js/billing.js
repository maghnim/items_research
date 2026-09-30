// Plan and trial checkouts go through checkout.html links (js/checkout.js).

async function openBillingPortal() {
  try {
    const { url } = await api('/billing/stripe/portal');
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

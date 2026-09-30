function showFormMessage(el, text, type) {
  el.textContent = text;
  el.className = `form-msg ${type}`;
}

// ?next= is the checkout.html link that sent the visitor here (see checkout.js). Only
// checkout.html is accepted, so the parameter can't bounce anyone to another site.
const nextParam = new URLSearchParams(window.location.search).get('next');
const nextPage = nextParam && /^checkout\.html\?[\w=&%-]*$/.test(nextParam) ? nextParam : null;

function afterAuthPage() {
  return nextPage || 'dashboard.html';
}

// Switching between signup and login keeps ?next=. Delegated, because the i18n engine
// re-renders some of these links after load.
document.addEventListener('click', (e) => {
  const link = nextPage && e.target.closest && e.target.closest('a[href="login.html"], a[href="signup.html"]');
  if (link) link.href = `${link.getAttribute('href')}?next=${encodeURIComponent(nextPage)}`;
});

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('form-msg');
    const fullName = document.getElementById('fullname').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const phone = document.getElementById('phone').value.trim();
    const submitBtn = signupForm.querySelector('button[type="submit"]');

    if (password !== confirmPassword) {
      showFormMessage(msg, t('signup.error.passwordmismatch'), 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('signup.submit.loading');

    try {
      const data = await api('/auth/signup', { method: 'POST', body: { email, password, fullName, phone: phone || null } });
      setToken(data.token);
      setUser(data.user);
      // Back to the checkout link they came from; otherwise the dashboard's paywall
      // banner offers the free trial.
      window.location.href = afterAuthPage();
    } catch (err) {
      showFormMessage(msg, err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = t('signup.submit');
    }
  });
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('form-msg');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = t('login.submit.loading');

    try {
      const data = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(data.token);
      setUser(data.user);
      window.location.href = afterAuthPage();
    } catch (err) {
      showFormMessage(msg, err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = t('login.submit');
    }
  });
}

function logout() {
  clearToken();
  window.location.href = 'login.html';
}

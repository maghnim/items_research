function showFormMessage(el, text, type) {
  el.textContent = text;
  el.className = `form-msg ${type}`;
}

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('form-msg');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = signupForm.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = t('signup.submit.loading');

    try {
      const data = await api('/auth/signup', { method: 'POST', body: { email, password } });
      setToken(data.token);
      setUser(data.user);
      window.location.href = 'dashboard.html';
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
      window.location.href = 'dashboard.html';
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

// Update PRODUCTION_API_URL after deploying the backend (see DEPLOY.md).
const PRODUCTION_API_URL = 'https://pricepilot-api-cfl6.onrender.com/api';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4000/api'
  : PRODUCTION_API_URL;

function getToken() {
  return localStorage.getItem('pp_token');
}

function setToken(token) {
  localStorage.setItem('pp_token', token);
}

function clearToken() {
  localStorage.removeItem('pp_token');
  localStorage.removeItem('pp_user');
}

function getUser() {
  const raw = localStorage.getItem('pp_user');
  return raw ? JSON.parse(raw) : null;
}

function setUser(user) {
  localStorage.setItem('pp_user', JSON.stringify(user));
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

function requireAuthOrRedirect() {
  if (!getToken()) {
    window.location.href = 'login.html';
  }
}

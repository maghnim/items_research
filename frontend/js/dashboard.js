requireAuthOrRedirect();

const user = getUser();
if (user) {
  const el = document.getElementById('user-email');
  if (el) el.textContent = user.email;
}

async function loadProducts() {
  const listEl = document.getElementById('products-tbody');
  const emptyEl = document.getElementById('products-empty');
  try {
    const { products } = await api('/products');
    renderStats(products);

    if (products.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    listEl.innerHTML = products.map(rowHtml).join('');
  } catch (err) {
    listEl.innerHTML = `<tr><td colspan="6">Failed to load products: ${err.message}</td></tr>`;
  }
}

function renderStats(products) {
  document.getElementById('stat-total').textContent = products.length;
  document.getElementById('stat-active').textContent = products.filter((p) => p.is_active).length;
  const withPrice = products.filter((p) => p.last_price !== null);
  document.getElementById('stat-tracked').textContent = withPrice.length;
  document.getElementById('stat-plan').textContent = (user?.plan_tier || 'trial').toUpperCase();
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', MAD: 'DH', JPY: '¥', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' };

function formatPrice(amount, currency) {
  const code = currency || 'USD';
  const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
  const value = Number(amount).toFixed(2);
  return code === 'MAD' ? `${value} ${symbol}` : `${symbol}${value}`;
}

function rowHtml(p) {
  const name = p.nickname || p.competitor_name || new URL(p.url).hostname;
  const price = p.last_price !== null ? formatPrice(p.last_price, p.last_currency) : '—';
  const status = p.is_active
    ? '<span class="badge badge-active">Active</span>'
    : '<span class="badge badge-inactive">Paused</span>';
  const checked = p.last_checked_at ? new Date(p.last_checked_at).toLocaleString() : 'Not checked yet';

  return `
    <tr>
      <td><strong>${escapeHtml(name)}</strong><br><a href="${p.url}" target="_blank" rel="noopener" style="font-size:12.5px;">${truncate(p.url, 42)}</a></td>
      <td>${price}</td>
      <td>${status}</td>
      <td style="font-size:13px;color:#64748b;">${checked}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="checkNow('${p.id}', this)">Check now</button>
        <button class="btn btn-outline btn-sm" onclick="toggleActive('${p.id}', ${!p.is_active})">${p.is_active ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>
  `;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function checkNow(id, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    await api(`/products/${id}/check`, { method: 'POST' });
    loadProducts();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function toggleActive(id, newState) {
  try {
    await api(`/products/${id}`, { method: 'PATCH', body: { is_active: newState } });
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('Stop tracking this product? This removes its price history too.')) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

// --- Add product modal ---
const modal = document.getElementById('add-product-modal');
document.getElementById('open-add-modal')?.addEventListener('click', () => modal.classList.add('open'));
document.getElementById('close-add-modal')?.addEventListener('click', () => modal.classList.remove('open'));

const addForm = document.getElementById('add-product-form');
if (addForm) {
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('add-product-msg');
    const url = document.getElementById('product-url').value.trim();
    const nickname = document.getElementById('product-nickname').value.trim();
    const threshold = document.getElementById('product-threshold').value;
    const currency = document.getElementById('product-currency').value;
    const submitBtn = addForm.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

    try {
      await api('/products', {
        method: 'POST',
        body: { url, nickname, alert_threshold_pct: threshold ? Number(threshold) : 0, currency: currency || undefined },
      });
      modal.classList.remove('open');
      addForm.reset();
      msg.style.display = 'none';
      loadProducts();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start tracking';
    }
  });
}

loadProducts();

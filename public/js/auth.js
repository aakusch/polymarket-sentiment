// ── Auth State & UI ─────────────────────────────────────────────────────────

const authState = {
  token: null,
  user: null,
};

function initAuth() {
  const saved = localStorage.getItem('pmsi_token');
  if (saved) {
    try {
      // Decode JWT to check expiry (payload is base64url between dots)
      const payload = JSON.parse(atob(saved.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp * 1000 > Date.now()) {
        authState.token = saved;
        authState.user = JSON.parse(localStorage.getItem('pmsi_user') || 'null');
      } else {
        localStorage.removeItem('pmsi_token');
        localStorage.removeItem('pmsi_user');
      }
    } catch {
      localStorage.removeItem('pmsi_token');
      localStorage.removeItem('pmsi_user');
    }
  }
  renderAuthButton();
}

function setAuth(token, user) {
  authState.token = token;
  authState.user = user;
  localStorage.setItem('pmsi_token', token);
  localStorage.setItem('pmsi_user', JSON.stringify(user));
  renderAuthButton();
}

function logout() {
  authState.token = null;
  authState.user = null;
  localStorage.removeItem('pmsi_token');
  localStorage.removeItem('pmsi_user');
  renderAuthButton();
  // Refresh current page
  handleRoute();
}

function authHeaders() {
  if (!authState.token) return {};
  return { Authorization: 'Bearer ' + authState.token };
}

// ── Phantom Wallet ─────────────────────────────────────────────────────────

async function connectPhantom() {
  if (!window.solana?.isPhantom) {
    alert('Phantom wallet not found. Install it from phantom.app');
    return;
  }

  try {
    const resp = await window.solana.connect();
    const publicKey = resp.publicKey.toString();

    const nonce = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const message = `Sign in to PMSI\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

    const encoded = new TextEncoder().encode(message);
    const { signature } = await window.solana.signMessage(encoded, 'utf8');

    const res = await fetch('/api/auth/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        signature: btoa(String.fromCharCode(...signature)),
        message,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Wallet login failed');
      return;
    }

    const data = await res.json();
    setAuth(data.token, data.user);
    closeAuthModal();
    tryMigrateLocalIndicators();
  } catch (err) {
    if (err.code !== 4001) { // 4001 = user rejected
      console.error('Phantom connect error:', err);
      alert('Failed to connect wallet');
    }
  }
}

// ── Email Auth ─────────────────────────────────────────────────────────────

async function loginEmail(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json();
    return { error: err.error || 'Login failed' };
  }

  const data = await res.json();
  setAuth(data.token, data.user);
  closeAuthModal();
  tryMigrateLocalIndicators();
  return {};
}

async function registerEmail(email, password, displayName) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });

  if (!res.ok) {
    const err = await res.json();
    return { error: err.error || 'Registration failed' };
  }

  const data = await res.json();
  setAuth(data.token, data.user);
  closeAuthModal();
  tryMigrateLocalIndicators();
  return {};
}

// ── localStorage Migration ─────────────────────────────────────────────────

async function tryMigrateLocalIndicators() {
  const raw = localStorage.getItem('pcsi_indicators');
  if (!raw || !authState.token) return;

  try {
    const indicators = JSON.parse(raw);
    if (indicators.length === 0) return;

    const res = await fetch('/api/indicators/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ indicators }),
    });

    if (res.ok) {
      localStorage.removeItem('pcsi_indicators');
      handleRoute(); // Refresh page
    }
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// ── Auth UI ────────────────────────────────────────────────────────────────

function renderAuthButton() {
  const el = document.getElementById('auth-area');
  if (!el) return;

  if (authState.user) {
    const label = authState.user.wallet
      ? authState.user.wallet.slice(0, 4) + '..' + authState.user.wallet.slice(-4)
      : authState.user.email || 'Account';
    el.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400">${label}</span>
        <button onclick="logout()" class="px-2 py-1 text-xs bg-gray-700 text-gray-400 rounded hover:bg-gray-600 transition-colors">Logout</button>
      </div>`;
  } else {
    el.innerHTML = `
      <button onclick="openAuthModal()" class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Sign In</button>`;
  }
}

function openAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
  switchAuthTab('login');
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function switchAuthTab(tab) {
  const loginTab = document.getElementById('auth-tab-login');
  const registerTab = document.getElementById('auth-tab-register');
  const loginForm = document.getElementById('auth-form-login');
  const registerForm = document.getElementById('auth-form-register');

  if (tab === 'login') {
    loginTab.classList.add('border-blue-500', 'text-gray-200');
    loginTab.classList.remove('border-transparent', 'text-gray-500');
    registerTab.classList.remove('border-blue-500', 'text-gray-200');
    registerTab.classList.add('border-transparent', 'text-gray-500');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    registerTab.classList.add('border-blue-500', 'text-gray-200');
    registerTab.classList.remove('border-transparent', 'text-gray-500');
    loginTab.classList.remove('border-blue-500', 'text-gray-200');
    loginTab.classList.add('border-transparent', 'text-gray-500');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }

  document.getElementById('auth-error').textContent = '';
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  const result = await loginEmail(email, password);
  if (result.error) errEl.textContent = result.error;
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const name = document.getElementById('register-name').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  const result = await registerEmail(email, password, name);
  if (result.error) errEl.textContent = result.error;
}

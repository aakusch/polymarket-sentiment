// ── API Panel ───────────────────────────────────────────────────────────────

async function renderApiPanel() {
  const el = document.getElementById('api-panel-content');
  if (!el) return;

  if (!authState.token) {
    el.innerHTML = `
      <div class="bg-gray-900/50 rounded-2xl p-8 border border-gray-800/50 text-center">
        <div class="text-gray-400 mb-2">Sign in to manage API keys</div>
        <p class="text-gray-500 text-sm mb-4">Create API keys to access indicator data programmatically.</p>
        <button onclick="openAuthModal()" class="px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">Sign In</button>
      </div>`;
    return;
  }

  el.innerHTML = '<div class="text-gray-500 text-sm">Loading...</div>';

  try {
    const [keys, indicators] = await Promise.all([
      fetch('/api/keys', { headers: authHeaders() }).then(r => r.json()),
      fetch('/api/indicators', { headers: authHeaders() }).then(r => r.json()),
    ]);

    let html = '';

    // API Keys section
    html += `
      <section class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-medium text-gray-200">API Keys</h2>
          <button onclick="createApiKey()" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">+ New Key</button>
        </div>
        <div id="new-key-banner" class="hidden mb-4 bg-green-900/30 border border-green-700/50 rounded-xl p-4">
          <div class="text-sm text-green-400 mb-1">Key created! Copy it now — it won't be shown again.</div>
          <code id="new-key-value" class="text-xs text-green-300 bg-gray-800 px-3 py-2 rounded block break-all select-all"></code>
        </div>`;

    if (keys.length === 0) {
      html += `<div class="bg-gray-900/50 rounded-xl p-6 border border-gray-800/50 text-center text-sm text-gray-500">No API keys yet</div>`;
    } else {
      html += `<div class="space-y-3">`;
      for (const key of keys) {
        const status = key.revoked
          ? '<span class="text-red-400">Revoked</span>'
          : '<span class="text-green-400">Active</span>';
        html += `
          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50 flex items-center justify-between">
            <div>
              <code class="text-sm text-gray-300">${key.prefix}...</code>
              ${key.label ? `<span class="text-xs text-gray-500 ml-2">${key.label}</span>` : ''}
              <div class="text-xs text-gray-500 mt-1">Credits: ${key.credits} &middot; ${status}</div>
            </div>
            ${!key.revoked ? `<button onclick="revokeApiKey('${key.id}')" class="px-3 py-1 text-xs bg-gray-700 text-gray-400 rounded hover:bg-red-900/50 hover:text-red-300 transition-colors">Revoke</button>` : ''}
          </div>`;
      }
      html += `</div>`;
    }
    html += `</section>`;

    // Credits section
    html += `
      <section class="mb-8">
        <h2 class="text-lg font-medium text-gray-200 mb-4">Credits</h2>
        <div class="bg-gray-900/50 rounded-xl p-6 border border-gray-800/50">
          <div id="credit-balance" class="text-sm text-gray-400">Loading balance...</div>
        </div>
      </section>`;

    // Indicators with bundle pricing
    html += `
      <section class="mb-8">
        <h2 class="text-lg font-medium text-gray-200 mb-4">Your Indicators</h2>`;

    if (indicators.length === 0) {
      html += `<div class="bg-gray-900/50 rounded-xl p-6 border border-gray-800/50 text-center text-sm text-gray-500">No indicators. <a href="#builder" class="text-blue-400 hover:underline">Build one</a></div>`;
    } else {
      html += `<div class="space-y-3">`;
      for (const ind of indicators) {
        const bp = ind.bundlePrices || {};
        const hasPricing = bp[10] || bp[50] || bp[100] || bp[500];
        const pricingHtml = hasPricing
          ? `<div class="flex gap-2 mt-1">${[10, 50, 100, 500].map(t => bp[t] ? `<span class="text-[10px] px-1.5 py-0.5 bg-gray-800/60 rounded text-gray-400">${t}: ${bp[t]} SOL</span>` : '').filter(Boolean).join('')}</div>`
          : '<span class="text-gray-500">Free</span>';

        html += `
          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium text-gray-200">${ind.name}</span>
              <span class="text-xs text-gray-500">${ind.asset || 'BTC'} &middot; ${ind.isPublic ? 'Public' : 'Private'}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-gray-500">Public page:</span>
                <a href="/i/${ind.id}" class="text-blue-400 hover:underline ml-1">/i/${ind.id}</a>
              </div>
              <div>
                <span class="text-gray-500">API endpoint:</span>
                <code class="text-blue-400 ml-1">/api/v1/indicators/${ind.id}</code>
              </div>
              <div class="sm:col-span-2">
                <span class="text-gray-500">Pricing:</span>
                <span class="ml-1">${pricingHtml}</span>
              </div>
            </div>
            <div class="mt-2">
              <button onclick="initCreditPurchase('${ind.id}','${ind.name.replace(/'/g, "\\'")}')" class="px-3 py-1 text-xs bg-blue-600/80 text-white rounded hover:bg-blue-500 transition-colors">Buy Credits</button>
            </div>
          </div>`;
      }
      html += `</div>`;
    }
    html += `</section>`;

    // API v2 Documentation
    html += `
      <section class="mb-8">
        <h2 class="text-lg font-medium text-gray-200 mb-4">API v2 Endpoints</h2>
        <div class="space-y-4">
          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded">GET</span>
              <code class="text-sm text-blue-400">/api/v2/indicators</code>
              <span class="text-xs text-gray-500">0 credits</span>
            </div>
            <p class="text-xs text-gray-400 mb-3">List all public indicators with scores and metadata.</p>
            <details class="text-xs">
              <summary class="text-gray-500 cursor-pointer hover:text-gray-300">Query params & examples</summary>
              <div class="mt-2 space-y-2 text-gray-400">
                <div><code class="text-gray-300">sort</code> — score (default), newest, name</div>
                <div><code class="text-gray-300">sector</code> — filter by sector (crypto)</div>
                <div><code class="text-gray-300">asset</code> — filter by asset (BTC, ETH)</div>
                <div><code class="text-gray-300">limit</code> — 1-100 (default 20)</div>
                <div><code class="text-gray-300">offset</code> — pagination offset</div>
                <div class="mt-3 bg-gray-800 rounded p-3">
                  <div class="text-gray-500 mb-1">curl</div>
                  <code class="text-green-400 break-all">curl -H "X-API-Key: your_key" "https://pmsi.app/api/v2/indicators?sort=score&asset=BTC"</code>
                </div>
              </div>
            </details>
          </div>

          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded">GET</span>
              <code class="text-sm text-blue-400">/api/v2/indicators/{id}/latest</code>
              <span class="text-xs text-gray-500">1 credit</span>
            </div>
            <p class="text-xs text-gray-400 mb-3">Get current score and label for an indicator. Cheapest call.</p>
          </div>

          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded">GET</span>
              <code class="text-sm text-blue-400">/api/v2/indicators/{id}/timeseries</code>
              <span class="text-xs text-gray-500">1 credit</span>
            </div>
            <p class="text-xs text-gray-400 mb-3">Get full timeseries with date-range filtering. Includes predictive score.</p>
          </div>
        </div>
      </section>`;

    el.innerHTML = html;
    loadCreditBalance();
  } catch (err) {
    el.innerHTML = `<div class="text-red-400 text-sm">Failed to load API data: ${err.message}</div>`;
  }
}

async function createApiKey() {
  const label = prompt('Key label (optional):');
  try {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ label: label || undefined }),
    });
    const data = await res.json();
    if (data.key) {
      const banner = document.getElementById('new-key-banner');
      const value = document.getElementById('new-key-value');
      if (banner && value) {
        value.textContent = data.key;
        banner.classList.remove('hidden');
      }
      renderApiPanel();
    }
  } catch (err) {
    alert('Failed to create key: ' + err.message);
  }
}

async function revokeApiKey(id) {
  if (!confirm('Revoke this API key? This cannot be undone.')) return;
  try {
    await fetch('/api/keys/' + id, { method: 'DELETE', headers: authHeaders() });
    renderApiPanel();
  } catch (err) {
    alert('Failed to revoke key: ' + err.message);
  }
}

async function loadCreditBalance() {
  try {
    const res = await fetch('/api/credits/balance', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById('credit-balance');
      if (el) {
        el.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="text-gray-400">Available Credits</span>
            <span class="text-xl font-semibold text-gray-100">${data.credits.toLocaleString()}</span>
          </div>`;
      }
    }
  } catch { /* ignore */ }
}

async function initCreditPurchase(indicatorId, indicatorName) {
  if (!window.solana?.isPhantom) {
    alert('Phantom wallet required for credit purchases');
    return;
  }

  if (!indicatorId) {
    indicatorId = prompt('Indicator ID to buy credits for:');
    if (!indicatorId) return;
  }

  // Fetch available bundles
  let bundles;
  try {
    const res = await fetch(`/api/credits/bundles?indicatorId=${indicatorId}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to fetch bundles');
      return;
    }
    const data = await res.json();
    bundles = data.bundles;
  } catch (err) {
    alert('Failed to fetch bundle pricing: ' + err.message);
    return;
  }

  // Build bundle selection prompt
  const available = bundles.filter(b => b.price != null);
  if (available.length === 0) {
    // All free — just pick a tier
    const credits = parseInt(prompt('This indicator is free. How many credits? (10, 50, 100, 500):', '100'));
    if (![10, 50, 100, 500].includes(credits)) return;

    const keysRes = await fetch('/api/keys', { headers: authHeaders() });
    const keys = await keysRes.json();
    const activeKeys = keys.filter(k => !k.revoked);
    if (activeKeys.length === 0) { alert('Create an API key first'); return; }

    const purchaseRes = await fetch('/api/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ indicatorId, bundle: credits, apiKeyId: activeKeys[0].id }),
    });
    if (purchaseRes.ok) {
      alert(`${credits} free credits added!`);
      renderApiPanel();
    }
    return;
  }

  const options = available.map(b => `${b.calls} calls = ${b.price} SOL`).join('\n');
  const choice = prompt(`Select a bundle for ${indicatorName || indicatorId}:\n\n${options}\n\nEnter number of calls (${available.map(b => b.calls).join(', ')}):`);
  const bundle = parseInt(choice);
  if (![10, 50, 100, 500].includes(bundle)) return;

  const selected = bundles.find(b => b.calls === bundle);
  if (!selected || selected.price == null) {
    alert('That bundle tier is not available');
    return;
  }

  // Get API keys
  const keysRes = await fetch('/api/keys', { headers: authHeaders() });
  const keys = await keysRes.json();
  const activeKeys = keys.filter(k => !k.revoked);
  if (activeKeys.length === 0) { alert('Create an API key first'); return; }
  const apiKeyId = activeKeys[0].id;

  try {
    // Get payment params
    const purchaseRes = await fetch('/api/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ indicatorId, bundle, apiKeyId }),
    });

    if (!purchaseRes.ok) {
      const err = await purchaseRes.json();
      alert(err.error || 'Purchase failed');
      return;
    }

    const purchase = await purchaseRes.json();

    // Build Solana transaction
    await window.solana.connect();
    const connection = new solanaWeb3.Connection(
      'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    const fromPubkey = window.solana.publicKey;
    const toPubkey = new solanaWeb3.PublicKey(purchase.recipientWallet);
    const lamports = Math.round(purchase.amount * solanaWeb3.LAMPORTS_PER_SOL);

    const tx = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({ fromPubkey, toPubkey, lamports })
    );

    // Add memo
    const memoProgram = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    tx.add({
      keys: [{ pubkey: fromPubkey, isSigner: true, isWritable: true }],
      programId: memoProgram,
      data: Buffer.from(`pmsi:${purchase.paymentId}`),
    });

    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = fromPubkey;

    const signed = await window.solana.signTransaction(tx);
    const txSignature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(txSignature, 'confirmed');

    // Verify with backend
    const verifyRes = await fetch('/api/credits/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ paymentId: purchase.paymentId, txSignature }),
    });

    if (verifyRes.ok) {
      alert(`Success! ${bundle} credits added.`);
      renderApiPanel();
    } else {
      const err = await verifyRes.json();
      alert('Verification failed: ' + (err.error || 'Unknown error'));
    }
  } catch (err) {
    if (err.code !== 4001) {
      console.error('Purchase error:', err);
      alert('Transaction failed: ' + err.message);
    }
  }
}

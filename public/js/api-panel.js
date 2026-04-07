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

    // Indicators with API info
    html += `
      <section class="mb-8">
        <h2 class="text-lg font-medium text-gray-200 mb-4">Your Indicators</h2>`;

    if (indicators.length === 0) {
      html += `<div class="bg-gray-900/50 rounded-xl p-6 border border-gray-800/50 text-center text-sm text-gray-500">No indicators. <a href="#builder" class="text-blue-400 hover:underline">Build one</a></div>`;
    } else {
      html += `<div class="space-y-3">`;
      for (const ind of indicators) {
        const price = ind.pricePer100 ? `${ind.pricePer100} ${ind.priceToken || 'SOL'} / 100 calls` : 'Free';
        html += `
          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium text-gray-200">${ind.name}</span>
              <span class="text-xs text-gray-500">${ind.asset} &middot; ${ind.isPublic ? 'Public' : 'Private'}</span>
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
              <div>
                <span class="text-gray-500">Pricing:</span>
                <span class="text-gray-300 ml-1">${price}</span>
              </div>
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
            <details class="text-xs">
              <summary class="text-gray-500 cursor-pointer hover:text-gray-300">Examples</summary>
              <div class="mt-2 space-y-2">
                <div class="bg-gray-800 rounded p-3">
                  <div class="text-gray-500 mb-1">Python</div>
                  <code class="text-green-400 break-all">import requests<br>r = requests.get("https://pmsi.app/api/v2/indicators/abc123/latest", headers={"X-API-Key": "your_key"})<br>print(r.json()["score"], r.json()["label"])</code>
                </div>
              </div>
            </details>
          </div>

          <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded">GET</span>
              <code class="text-sm text-blue-400">/api/v2/indicators/{id}/timeseries</code>
              <span class="text-xs text-gray-500">1 credit</span>
            </div>
            <p class="text-xs text-gray-400 mb-3">Get full timeseries with date-range filtering.</p>
            <details class="text-xs">
              <summary class="text-gray-500 cursor-pointer hover:text-gray-300">Query params & examples</summary>
              <div class="mt-2 space-y-2 text-gray-400">
                <div><code class="text-gray-300">start</code> — start date (YYYY-MM-DD)</div>
                <div><code class="text-gray-300">end</code> — end date (YYYY-MM-DD)</div>
                <div class="mt-3 bg-gray-800 rounded p-3">
                  <div class="text-gray-500 mb-1">JavaScript</div>
                  <code class="text-green-400 break-all">const res = await fetch("https://pmsi.app/api/v2/indicators/abc123/timeseries?start=2026-01-01&end=2026-04-01", { headers: { "X-API-Key": "your_key" } });<br>const { timeseries } = await res.json();</code>
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>`;

    // Token & Credits section
    html += `
      <section class="mb-8">
        <h2 class="text-lg font-medium text-gray-200 mb-4">PMSI Token Credits</h2>
        <div id="token-credits-section" class="space-y-4">
          <div class="bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-xl p-6 border border-purple-700/30">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-full bg-purple-600/30 flex items-center justify-center text-purple-400 font-bold text-sm">P</div>
              <div>
                <div class="text-sm font-medium text-gray-200">PMSI Token</div>
                <div class="text-xs text-gray-500">Hold tokens for daily API credit allowance</div>
              </div>
            </div>
            <div id="token-info-body" class="text-sm text-gray-400">Loading token info...</div>
          </div>
          <div id="credit-balance-card" class="bg-gray-900/50 rounded-xl p-6 border border-gray-800/50">
            <div id="credit-balance" class="text-sm text-gray-400">Loading balance...</div>
          </div>
          <div class="flex gap-3">
            <button onclick="initCreditPurchase()" class="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-500 transition-colors">Buy Credits (SOL)</button>
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
  // Load token info (public, no auth required)
  try {
    const infoRes = await fetch('/api/credits/token-info');
    if (infoRes.ok) {
      const info = await infoRes.json();
      const el = document.getElementById('token-info-body');
      if (el) {
        if (info.enabled) {
          el.innerHTML = `
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-gray-500 text-xs">Contract:</span>
                <code class="text-xs text-purple-300 bg-gray-800/60 px-2 py-0.5 rounded font-mono">${info.mint}</code>
                <button onclick="navigator.clipboard.writeText('${info.mint}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" class="text-xs text-gray-500 hover:text-purple-400 transition-colors">Copy</button>
              </div>
              <div class="text-xs text-gray-400">${info.pricing}</div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                ${info.tiers.map(t => `
                  <div class="bg-gray-800/40 rounded-lg p-2 text-center">
                    <div class="text-xs font-medium text-gray-300">${t.name}</div>
                    <div class="text-xs text-purple-400">${t.tokens} PMSI</div>
                    <div class="text-xs text-gray-500">${t.dailyCalls.toLocaleString()}/day</div>
                  </div>
                `).join('')}
              </div>
            </div>`;
        } else {
          el.innerHTML = `
            <div class="text-xs text-gray-500">
              Token not deployed yet. Credits can be purchased with SOL.
              <br>Once live, hold PMSI tokens for ${info.creditsPerToken} API calls/day per token.
            </div>`;
        }
      }
    }
  } catch { /* ignore */ }

  // Load balance (requires auth)
  try {
    const res = await fetch('/api/credits/balance', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById('credit-balance');
      if (el) {
        let html = `<div class="space-y-3">`;

        // Total available
        html += `
          <div class="flex items-center justify-between">
            <span class="text-gray-400">Total Available</span>
            <span class="text-xl font-semibold text-gray-100">${data.totalAvailable.toLocaleString()} credits</span>
          </div>
          <div class="w-full h-px bg-gray-700/50"></div>`;

        // DB credits
        html += `
          <div class="flex items-center justify-between text-xs">
            <span class="text-gray-500">Purchased credits</span>
            <span class="text-gray-300">${data.dbCredits.toLocaleString()}</span>
          </div>`;

        // Token credits
        if (data.token.enabled) {
          html += `
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">PMSI token balance</span>
              <span class="text-purple-400">${data.tokenBalance.toLocaleString()} PMSI</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">Token daily allowance</span>
              <span class="text-gray-300">${data.tokenDailyAllowance.toLocaleString()}/day</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">Token calls used today</span>
              <span class="text-gray-300">${data.tokenCallsUsedToday}/${data.tokenDailyAllowance.toLocaleString()}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">Token credits remaining</span>
              <span class="text-green-400">${data.tokenCreditsRemaining.toLocaleString()}</span>
            </div>`;
        } else if (data.tokenBalance === 0 && !data.token.enabled) {
          html += `
            <div class="text-xs text-gray-600 mt-1">Token credits available once PMSI token is deployed.</div>`;
        }

        html += `</div>`;
        el.innerHTML = html;
      }
    }
  } catch { /* ignore */ }
}

async function initCreditPurchase() {
  if (!window.solana?.isPhantom) {
    alert('Phantom wallet required for credit purchases');
    return;
  }

  const indicatorId = prompt('Indicator ID to buy credits for:');
  if (!indicatorId) return;

  const credits = parseInt(prompt('Number of credits (100 minimum):', '100'));
  if (!credits || credits < 100) return;

  // Get API keys
  const keysRes = await fetch('/api/keys', { headers: authHeaders() });
  const keys = await keysRes.json();
  const activeKeys = keys.filter(k => !k.revoked);
  if (activeKeys.length === 0) {
    alert('Create an API key first');
    return;
  }
  const apiKeyId = activeKeys[0].id;

  try {
    // Get payment params from server
    const purchaseRes = await fetch('/api/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ indicatorId, credits, apiKeyId }),
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
      alert(`Success! ${credits} credits added.`);
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

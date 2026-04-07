const bcrypt = require('bcryptjs');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const { getDb } = require('../_lib/db');
const { signToken, authenticate } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  const { action } = req.query;

  switch (action) {
    case 'login': return handleLogin(req, res);
    case 'register': return handleRegister(req, res);
    case 'me': return handleMe(req, res);
    case 'wallet': return handleWallet(req, res);
    default: return res.status(404).json({ error: 'Not found' });
  }
};

async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const sql = getDb();
  const rows = await sql`
    SELECT id, email, password_hash, wallet_address, display_name
    FROM users WHERE email = ${email.toLowerCase().trim()}
  `;
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  if (!user.password_hash) return res.status(401).json({ error: 'Account uses wallet login only' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user.id, user.wallet_address);
  res.json({ token, user: { id: user.id, email: user.email, wallet: user.wallet_address, displayName: user.display_name } });
}

async function handleRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password, displayName } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const passwordHash = await bcrypt.hash(password, 12);
  const sql = getDb();
  try {
    const rows = await sql`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${displayName || null})
      RETURNING id, email, display_name
    `;
    const user = rows[0];
    const token = signToken(user.id, null);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
}

async function handleMe(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  const rows = await sql`SELECT id, email, wallet_address, display_name, created_at FROM users WHERE id = ${auth.id}`;
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const user = rows[0];
  res.json({ user: { id: user.id, email: user.email, wallet: user.wallet_address, displayName: user.display_name, createdAt: user.created_at } });
}

async function handleWallet(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { publicKey, signature, message } = req.body || {};
  if (!publicKey || !signature || !message) return res.status(400).json({ error: 'Missing publicKey, signature, or message' });

  const tsMatch = message.match(/Timestamp:\s*(.+)/);
  if (tsMatch) {
    const ts = new Date(tsMatch[1]);
    const age = Date.now() - ts.getTime();
    if (age > 5 * 60 * 1000 || age < -60 * 1000) return res.status(400).json({ error: 'Signature expired' });
  }

  try {
    const pubKeyBytes = bs58.decode(publicKey);
    const sigBytes = typeof signature === 'string' ? new Uint8Array(Buffer.from(signature, 'base64')) : new Uint8Array(signature);
    const msgBytes = new TextEncoder().encode(message);
    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });
  } catch (err) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  try {
    const sql = getDb();
    const rows = await sql`
      INSERT INTO users (wallet_address, display_name)
      VALUES (${publicKey}, ${publicKey.slice(0, 8) + '...'})
      ON CONFLICT (wallet_address) DO UPDATE SET updated_at = now()
      RETURNING id, wallet_address, display_name, email
    `;
    const user = rows[0];
    const token = signToken(user.id, user.wallet_address);
    res.json({ token, user: { id: user.id, wallet: user.wallet_address, displayName: user.display_name, email: user.email } });
  } catch (err) {
    console.error('Wallet auth DB error:', err);
    res.status(500).json({ error: 'Server error during authentication' });
  }
}

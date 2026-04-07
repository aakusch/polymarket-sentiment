const jwt = require('jsonwebtoken');

function _secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

function signToken(userId, wallet) {
  return jwt.sign(
    { sub: userId, wallet: wallet || null },
    _secret(),
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, _secret());
}

/**
 * Extract and verify JWT from Authorization header.
 * Returns { id, wallet } or null.
 */
function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const payload = verifyToken(auth.slice(7));
    return { id: payload.sub, wallet: payload.wallet };
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, authenticate };

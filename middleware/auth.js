const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'civic-lens-dev-secret-change-me';
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Attaches req.userId if a valid Bearer token is present; does not reject
// the request. Use `requireAuth` on routes that must be logged in.
function attachUser(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.sub;
    } catch (e) {
      // expired/invalid token — treat as logged out, let requireAuth reject if needed
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  next();
}

module.exports = { signToken, attachUser, requireAuth, JWT_SECRET };

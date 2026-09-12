/* ============================================================
   K-Delta — Authentication & RBAC Authorization Middleware
   ============================================================ */

const authStore = require('../data/authStore');

/**
 * Extract token from Authorization header or cookie
 */
function extractToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  
  if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
      const [key, val] = cookie.trim().split('=');
      acc[key] = val;
      return acc;
    }, {});
    if (cookies.kdelta_token) return cookies.kdelta_token;
  }

  return null;
}

/**
 * Require valid user authentication
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const payload = authStore.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
  }

  req.user = payload;
  next();
}

/**
 * Require Admin Role (RBAC)
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  });
}

/**
 * Optional Authentication (attaches req.user if token present)
 */
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = authStore.verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

module.exports = {
  extractToken,
  requireAuth,
  requireAdmin,
  optionalAuth,
};

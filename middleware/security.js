/* ============================================================
   K-Delta — Web Security, OWASP Defense & Rate Limiting Middleware
   ============================================================ */

const rateLimitStore = new Map();

/**
 * Configure Security Headers (OWASP recommendations)
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS Filtering
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HTTP Strict Transport Security (HSTS) in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' ws: wss: https:;"
  );

  next();
}

/**
 * Strict CORS origin verification
 */
function corsPolicy(req, res, next) {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(o => o.trim());

  if (origin) {
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    } else {
      return res.status(403).json({ error: 'CORS policy: Origin not allowed' });
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
}

/**
 * Sliding Window Rate Limiter
 * @param {Object} options { windowMs, maxRequests, message }
 */
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const max = options.maxRequests || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '120', 10);
  const message = options.message || 'Too many requests, please try again later.';

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl || ''}${req.path}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record) {
      record = { requests: [] };
      rateLimitStore.set(key, record);
    }

    // Clean old requests outside window
    record.requests = record.requests.filter(timestamp => timestamp > now - windowMs);

    if (record.requests.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({
        error: message,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    }

    record.requests.push(now);
    next();
  };
}

/**
 * Input Sanitizer & Parameter Validator
 */
function sanitizeInput(req, res, next) {
  // Clean query parameters
  if (req.query && typeof req.query === 'object') {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/[<>'"]/g, '')
          .trim();
      }
    }
  }

  // Clean body parameters
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  next();
}

function sanitizeObject(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Prevent script injection tags & dangerous characters
      obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/[<>]/g, '')
                        .trim();
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeObject(obj[key]);
    }
  }
}

/**
 * Production-Safe Error Handler
 * Never exposes stack traces or database error details to clients
 */
function errorHandler(err, req, res, next) {
  // Log full error internally for monitoring
  console.error(`[SEC-ERROR] ${new Date().toISOString()} ${req.method} ${req.url}:`, err.message || err);

  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';

  res.status(status).json({
    error: status === 500 ? 'An internal error occurred. Please try again later.' : err.message,
    ...(isDev && err.stack ? { debugTrace: err.message } : {}),
  });
}

module.exports = {
  securityHeaders,
  corsPolicy,
  rateLimiter,
  sanitizeInput,
  errorHandler,
};

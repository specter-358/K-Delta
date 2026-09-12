/* ============================================================
   K-Delta — Production-Grade Indian Stock Market Backend Server
   OWASP Web Security, Auth & RBAC, Real-Time WebSocket Engine & Health Monitor
   ============================================================ */

require('dotenv').config();
const http = require('http');
const express = require('express');
const path = require('path');
const storage = require('./data/storage');
const authStore = require('./data/authStore');
const { provider, normalizeSymbol } = require('./data/marketProvider');
const { wsHub } = require('./data/wsHub');

const {
  securityHeaders,
  corsPolicy,
  rateLimiter,
  sanitizeInput,
  errorHandler,
} = require('./middleware/security');

const {
  requireAuth,
  requireAdmin,
  optionalAuth,
} = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize WebSocket Streaming Engine
wsHub.init(server);

// Security & Core Middleware
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(corsPolicy);
app.use(express.json({ limit: '1mb' }));
app.use(sanitizeInput);

// Global API Rate Limiter (120 req/min)
app.use('/api/', rateLimiter({ windowMs: 60000, maxRequests: 120 }));

// Static Assets
app.use(express.static(path.join(__dirname)));

/**
 * Get accurate Indian Market (IST) Status
 */
function getIndianMarketStatus() {
  const now = new Date();
  
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  const parts = istFormatter.formatToParts(now);
  const map = {};
  parts.forEach(p => map[p.type] = p.value);

  const weekday = map.weekday;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const totalMinutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  const isPreOpen = !isWeekend && (totalMinutes >= 540 && totalMinutes < 555);
  const isOpen = !isWeekend && (totalMinutes >= 555 && totalMinutes < 930);
  const isPostMarket = !isWeekend && (totalMinutes >= 930 && totalMinutes < 960);

  let statusText = 'Market Closed';
  let sessionState = 'CLOSED';

  if (isWeekend) {
    statusText = 'Market Closed (Weekend)';
    sessionState = 'WEEKEND';
  } else if (isOpen) {
    statusText = 'NSE / BSE — Market Open';
    sessionState = 'REGULAR';
  } else if (isPreOpen) {
    statusText = 'NSE / BSE — Pre-Open Session';
    sessionState = 'PRE_OPEN';
  } else if (isPostMarket) {
    statusText = 'NSE / BSE — Post-Market Closing';
    sessionState = 'POST_MARKET';
  } else {
    statusText = 'NSE / BSE — Market Closed';
    sessionState = 'CLOSED';
  }

  const istDisplay = now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: true,
  });

  return {
    isOpen,
    isPreOpen,
    isPostMarket,
    isWeekend,
    sessionState,
    statusText,
    exchange: 'NSE / BSE',
    currentTimeIST: `${istDisplay} IST`,
    tradingHours: '09:15 – 15:30 IST (Mon–Fri)',
    timezone: 'Asia/Kolkata (IST)',
    disclaimer: 'Informational analysis only. Not financial advice.',
  };
}

// ==========================================
// AUTHENTICATION & USER ENDPOINTS
// Strict Rate Limiter (10 req/min for auth)
// ==========================================
const authLimiter = rateLimiter({
  windowMs: 60000,
  maxRequests: 10,
  message: 'Too many authentication attempts. Please wait 1 minute.',
});

/**
 * POST /api/auth/signup
 */
app.post('/api/auth/signup', authLimiter, (req, res, next) => {
  try {
    const result = authStore.registerUser(req.body, req.ip);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 */
app.post('/api/auth/login', authLimiter, (req, res, next) => {
  try {
    const result = authStore.loginUser(req.body, req.ip);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 */
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = authStore.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

/**
 * POST /api/auth/2fa/setup
 */
app.post('/api/auth/2fa/setup', requireAuth, (req, res, next) => {
  try {
    const result = authStore.setup2FA(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/2fa/verify
 */
app.post('/api/auth/2fa/verify', requireAuth, (req, res, next) => {
  try {
    const result = authStore.verify2FA(req.user.userId, req.body.code, req.ip);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// REST MARKET DATA ROUTES
// ==========================================

/**
 * GET /api/market/status
 */
app.get('/api/market/status', (req, res) => {
  const status = getIndianMarketStatus();
  res.json(status);
});

/**
 * GET /api/quote?symbol=RELIANCE.NS
 */
app.get('/api/quote', async (req, res, next) => {
  const rawSymbol = String(req.query.symbol || '').replace(/[^a-zA-Z0-9^.-]/g, '').slice(0, 30);
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Valid symbol query parameter is required' });
  }

  try {
    const quote = await provider.getQuote(rawSymbol);
    if (!quote) {
      return res.status(404).json({ error: `Data unavailable for symbol: ${rawSymbol}` });
    }
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/quotes?symbols=RELIANCE.NS,TCS.NS
 */
app.get('/api/quotes', async (req, res, next) => {
  const rawSymbols = req.query.symbols;
  if (!rawSymbols) {
    return res.status(400).json({ error: 'Symbols query parameter is required' });
  }

  try {
    const symbolsList = rawSymbols.split(',').map(s => normalizeSymbol(s)).filter(Boolean);
    if (symbolsList.length === 0) return res.json([]);

    const results = [];
    for (const sym of symbolsList) {
      const q = await provider.getQuote(sym);
      if (q) results.push(q);
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/market/indices
 */
app.get('/api/market/indices', async (req, res, next) => {
  try {
    const indices = await provider.getMarketIndices();
    res.json(indices || []);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/candles?symbol=RELIANCE.NS&interval=1d&outputsize=120
 */
app.get('/api/candles', async (req, res, next) => {
  const rawSymbol = req.query.symbol;
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Symbol query parameter is required' });
  }

  const intervalParam = req.query.interval || '1day';
  const outputsize = parseInt(req.query.outputsize, 10) || 120;

  try {
    const candles = await provider.getHistoricalCandles(rawSymbol, intervalParam, outputsize);
    if (!candles || candles.length === 0) {
      return res.status(404).json({ error: `No candle data available for ${rawSymbol}` });
    }
    res.json(candles);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/search?q=Tata
 */
app.get('/api/search', async (req, res, next) => {
  const query = req.query.q;
  if (!query || query.trim().length < 1) {
    return res.json([]);
  }

  try {
    const results = await provider.searchSymbols(query);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/movers
 */
app.get('/api/movers', async (req, res, next) => {
  try {
    const movers = await provider.getMarketMovers();
    if (!movers) {
      return res.status(502).json({ error: 'Market movers temporarily unavailable' });
    }
    res.json(movers);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ISOLATED USER WATCHLIST ENDPOINTS
// ==========================================

/**
 * GET /api/watchlist
 */
app.get('/api/watchlist', optionalAuth, (req, res, next) => {
  try {
    const userId = req.user ? req.user.userId : 'guest';
    const list = storage.getWatchlist(userId);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/watchlist
 */
app.post('/api/watchlist', optionalAuth, (req, res, next) => {
  try {
    const userId = req.user ? req.user.userId : 'guest';
    const body = req.body;
    if (body.symbols && Array.isArray(body.symbols)) {
      storage.saveWatchlist(userId, body.symbols);
      return res.status(200).json(storage.getWatchlist(userId));
    }
    if (!body || !body.symbol) {
      return res.status(400).json({ error: 'Symbol is required to add to watchlist' });
    }

    const updated = storage.addToWatchlist(userId, body.symbol);
    res.status(201).json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/watchlist/:symbol
 */
app.delete('/api/watchlist/:symbol', optionalAuth, (req, res, next) => {
  try {
    const userId = req.user ? req.user.userId : 'guest';
    const updated = storage.removeFromWatchlist(userId, req.params.symbol);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// ADMIN SYSTEM HEALTH & SECURITY MONITORING
// Protected by requireAdmin RBAC
// ==========================================

/**
 * GET /api/admin/health
 */
app.get('/api/admin/health', requireAdmin, (req, res) => {
  const wsStats = wsHub.getActiveStats ? wsHub.getActiveStats() : {};
  const memUsage = process.memoryUsage();

  res.json({
    status: 'HEALTHY',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    system: {
      memoryRssMB: +(memUsage.rss / 1024 / 1024).toFixed(2),
      heapTotalMB: +(memUsage.heapTotal / 1024 / 1024).toFixed(2),
      heapUsedMB: +(memUsage.heapUsed / 1024 / 1024).toFixed(2),
    },
    webSockets: wsStats,
    marketDataEngine: {
      provider: 'NSE / BSE Multi-Provider Engine',
      status: 'OPERATIONAL',
      cacheTTL: process.env.CACHE_TTL_SECONDS || '15',
    },
    security: {
      headersEnabled: true,
      corsRestricted: process.env.NODE_ENV === 'production',
      rateLimitingActive: true,
    }
  });
});

/**
 * GET /api/admin/audit
 */
app.get('/api/admin/audit', requireAdmin, (req, res) => {
  res.json(authStore.getAuditLogs());
});

// SPA Fallback for HTML views
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Production Error Handler (catches all unhandled middleware errors)
app.use(errorHandler);

// Start Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`K-Delta Secure Indian Market Live Server Online`);
  console.log(`Local Web URL: http://localhost:${PORT}`);
  console.log(`WebSocket Stream: ws://localhost:${PORT}/ws`);
  console.log(`Market Timezone: Asia/Kolkata (IST)`);
  console.log(`Security: OWASP Headers | Rate Limiter | Auth & RBAC`);
  console.log(`====================================================`);
});

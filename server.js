/* ============================================================
   K-Delta — Institutional Indian Stock Market Backend Server
   Real-Time Data Proxy (NSE/BSE), IST Market Engine & Persistent Storage
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const storage = require('./data/storage');

const app = express();
const PORT = process.env.PORT || 3000;

// Suppress non-critical survey notices
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-Memory Cache for Rate-Limit Optimization
const cache = new Map();
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 15) * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (item && (Date.now() - item.timestamp) < CACHE_TTL_MS) {
    return item.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clean & normalize Indian stock ticker symbols
 */
function normalizeSymbol(sym) {
  if (!sym) return 'RELIANCE.NS';
  let s = sym.trim().toUpperCase();

  // Common index aliases
  if (s === 'NIFTY' || s === 'NIFTY50' || s === 'NIFTY 50') return '^NSEI';
  if (s === 'BANKNIFTY' || s === 'BANK NIFTY') return '^NSEBANK';
  if (s === 'SENSEX') return '^BSESN';
  if (s === 'NIFTYIT' || s === 'NIFTY IT') return '^CNXIT';
  if (s === 'VIX' || s === 'INDIAVIX' || s === 'INDIA VIX') return '^INDIAVIX';

  // If index starting with ^, return as is
  if (s.startsWith('^')) return s;

  // If already has suffix .NS or .BO, return as is
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;

  // Default to NSE (.NS) for Indian equities
  return `${s}.NS`;
}

/**
 * Get accurate Indian Market (IST) Status
 */
function getIndianMarketStatus() {
  const now = new Date();
  
  // Format current time in Asia/Kolkata
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

  const weekday = map.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const totalMinutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  // Trading Sessions (IST):
  // Pre-Open: 09:00 - 09:15 (540 - 555 mins)
  // Regular Market: 09:15 - 15:30 (555 - 930 mins)
  // Post-Market: 15:30 - 16:00 (930 - 960 mins)
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
  };
}

/**
 * Top liquid NIFTY constituents for movers calculation
 */
const INDIAN_ACTIVE_STOCKS = [
  'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
  'SBIN.NS', 'BHARTIARTL.NS', 'TATAMOTORS.NS', 'ITC.NS', 'LT.NS',
  'AXISBANK.NS', 'KOTAKBANK.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'TITAN.NS',
  'BAJFINANCE.NS', 'TATASTEEL.NS', 'NTPC.NS', 'ONGC.NS', 'POWERGRID.NS',
  'M&M.NS', 'WIPRO.NS', 'ADANIENT.NS', 'ADANIPORTS.NS', 'HINDUNILVR.NS',
  'ASIANPAINT.NS', 'ULTRACEMCO.NS', 'NESTLEIND.NS', 'JSWSTEEL.NS', 'GRASIM.NS',
];

// ==========================================
// API ROUTES
// ==========================================

/**
 * GET /api/market/status
 */
app.get('/api/market/status', (req, res) => {
  try {
    const status = getIndianMarketStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate market status', details: err.message });
  }
});

/**
 * GET /api/quote?symbol=RELIANCE.NS
 */
app.get('/api/quote', async (req, res) => {
  const rawSymbol = req.query.symbol;
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Symbol query parameter is required' });
  }

  const symbol = normalizeSymbol(rawSymbol);
  const cacheKey = `quote_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const quote = await yf.quote(symbol);
    if (!quote || quote.regularMarketPrice == null) {
      return res.status(404).json({ error: `Data unavailable for symbol: ${symbol}` });
    }

    const price = quote.regularMarketPrice;
    const change = quote.regularMarketChange != null ? quote.regularMarketChange : 0;
    const percentChange = quote.regularMarketChangePercent != null ? quote.regularMarketChangePercent : 0;
    const previousClose = quote.regularMarketPreviousClose != null ? quote.regularMarketPreviousClose : (price - change);

    const result = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || quote.symbol,
      price: parseFloat(price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      percentChange: parseFloat(percentChange.toFixed(2)),
      open: quote.regularMarketOpen != null ? parseFloat(quote.regularMarketOpen.toFixed(2)) : price,
      high: quote.regularMarketDayHigh != null ? parseFloat(quote.regularMarketDayHigh.toFixed(2)) : price,
      low: quote.regularMarketDayLow != null ? parseFloat(quote.regularMarketDayLow.toFixed(2)) : price,
      previousClose: parseFloat(previousClose.toFixed(2)),
      volume: quote.regularMarketVolume || 0,
      exchange: quote.exchange || (symbol.endsWith('.BO') ? 'BSE' : 'NSE'),
      marketCap: quote.marketCap || 0,
      currency: quote.currency || 'INR',
      timestamp: quote.regularMarketTime ? new Date(quote.regularMarketTime).toISOString() : new Date().toISOString(),
      timestampIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) + ' IST',
      isRealTime: true,
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(`Quote error for ${symbol}:`, err.message);
    res.status(502).json({ error: `Data unavailable for ${symbol}`, details: err.message });
  }
});

/**
 * GET /api/quotes?symbols=RELIANCE.NS,TCS.NS
 */
app.get('/api/quotes', async (req, res) => {
  const rawSymbols = req.query.symbols;
  if (!rawSymbols) {
    return res.status(400).json({ error: 'Symbols query parameter is required' });
  }

  const symbolsList = rawSymbols.split(',').map(s => normalizeSymbol(s)).filter(Boolean);
  if (symbolsList.length === 0) return res.json([]);

  const results = [];
  for (const sym of symbolsList) {
    const cacheKey = `quote_${sym}`;
    const cached = getCached(cacheKey);
    if (cached) {
      results.push(cached);
      continue;
    }

    try {
      const q = await yf.quote(sym);
      if (q && q.regularMarketPrice != null) {
        const quoteObj = {
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
          price: parseFloat(q.regularMarketPrice.toFixed(2)),
          change: parseFloat((q.regularMarketChange || 0).toFixed(2)),
          percentChange: parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
          open: parseFloat((q.regularMarketOpen || q.regularMarketPrice).toFixed(2)),
          high: parseFloat((q.regularMarketDayHigh || q.regularMarketPrice).toFixed(2)),
          low: parseFloat((q.regularMarketDayLow || q.regularMarketPrice).toFixed(2)),
          previousClose: parseFloat((q.regularMarketPreviousClose || (q.regularMarketPrice - (q.regularMarketChange || 0))).toFixed(2)),
          volume: q.regularMarketVolume || 0,
          exchange: q.exchange || (sym.endsWith('.BO') ? 'BSE' : 'NSE'),
          currency: q.currency || 'INR',
          timestampIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' }) + ' IST',
        };
        setCache(cacheKey, quoteObj);
        results.push(quoteObj);
      }
    } catch (err) {
      console.warn(`Failed to fetch batch quote for ${sym}:`, err.message);
    }
  }

  res.json(results);
});

/**
 * GET /api/market/indices
 * Real Indian Indices: NIFTY 50, SENSEX, BANK NIFTY, NIFTY IT, INDIA VIX
 */
app.get('/api/market/indices', async (req, res) => {
  const cacheKey = 'market_indices';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const indices = [
    { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE' },
    { symbol: '^BSESN', name: 'SENSEX', exchange: 'BSE' },
    { symbol: '^NSEBANK', name: 'BANK NIFTY', exchange: 'NSE' },
    { symbol: '^CNXIT', name: 'NIFTY IT', exchange: 'NSE' },
    { symbol: '^INDIAVIX', name: 'INDIA VIX', exchange: 'NSE' },
  ];

  const results = [];
  for (const idx of indices) {
    try {
      const q = await yf.quote(idx.symbol);
      if (q && q.regularMarketPrice != null) {
        results.push({
          symbol: idx.symbol,
          name: idx.name,
          displayName: idx.name,
          price: parseFloat(q.regularMarketPrice.toFixed(2)),
          change: parseFloat((q.regularMarketChange || 0).toFixed(2)),
          percentChange: parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
          open: parseFloat((q.regularMarketOpen || q.regularMarketPrice).toFixed(2)),
          high: parseFloat((q.regularMarketDayHigh || q.regularMarketPrice).toFixed(2)),
          low: parseFloat((q.regularMarketDayLow || q.regularMarketPrice).toFixed(2)),
          previousClose: parseFloat((q.regularMarketPreviousClose || q.regularMarketPrice).toFixed(2)),
          exchange: idx.exchange,
        });
      }
    } catch (err) {
      console.warn(`Index quote error for ${idx.symbol}:`, err.message);
    }
  }

  if (results.length > 0) {
    setCache(cacheKey, results);
  }
  res.json(results);
});

/**
 * GET /api/candles?symbol=RELIANCE.NS&interval=1d&outputsize=120
 */
app.get('/api/candles', async (req, res) => {
  const rawSymbol = req.query.symbol;
  if (!rawSymbol) {
    return res.status(400).json({ error: 'Symbol query parameter is required' });
  }

  const symbol = normalizeSymbol(rawSymbol);
  const intervalParam = (req.query.interval || '1day').toLowerCase();
  const outputsize = parseInt(req.query.outputsize, 10) || 120;

  // Map internal timeframe to Yahoo Finance interval and valid period range
  let yfInterval = '1d';
  let period1 = new Date();

  if (intervalParam === '1min' || intervalParam === '1m') {
    yfInterval = '1m';
    period1.setDate(period1.getDate() - 4); // Max 7d allowed by provider for 1m
  } else if (intervalParam === '5min' || intervalParam === '5m') {
    yfInterval = '5m';
    period1.setDate(period1.getDate() - 14); // Max 60d
  } else if (intervalParam === '15min' || intervalParam === '15m') {
    yfInterval = '15m';
    period1.setDate(period1.getDate() - 45); // Max 60d
  } else if (intervalParam === '1h' || intervalParam === '60min') {
    yfInterval = '1h';
    period1.setDate(period1.getDate() - 120); // Max 730d
  } else if (intervalParam === '1week' || intervalParam === '1wk' || intervalParam === '1w') {
    yfInterval = '1wk';
    period1.setFullYear(period1.getFullYear() - 3);
  } else {
    // 1day default
    yfInterval = '1d';
    period1.setDate(period1.getDate() - Math.max(outputsize * 2, 365));
  }

  const cacheKey = `candles_${symbol}_${yfInterval}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const chartData = await yf.chart(symbol, {
      period1: period1.toISOString().split('T')[0],
      interval: yfInterval,
    });

    if (!chartData || !chartData.quotes || chartData.quotes.length === 0) {
      return res.status(404).json({ error: `No candle data available for ${symbol}` });
    }

    // Filter valid numeric candles and eliminate empty null slots
    const validRaw = chartData.quotes.filter(q => 
      q && q.open != null && q.high != null && q.low != null && q.close != null && 
      !isNaN(q.open) && !isNaN(q.high) && !isNaN(q.low) && !isNaN(q.close) &&
      q.open > 0 && q.high > 0 && q.low > 0 && q.close > 0
    );

    if (validRaw.length === 0) {
      return res.status(404).json({ error: `Data unavailable for ${symbol}` });
    }

    const isDailyOrWeekly = (yfInterval === '1d' || yfInterval === '1wk');
    const candleMap = new Map();

    for (const q of validRaw) {
      const d = new Date(q.date);
      let timeKey;

      if (isDailyOrWeekly) {
        // Date formatted as YYYY-MM-DD in Asia/Kolkata (IST) timezone
        timeKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
      } else {
        // Numeric UNIX timestamp in seconds
        timeKey = Math.floor(d.getTime() / 1000);
      }

      candleMap.set(timeKey, {
        time: timeKey,
        open: parseFloat(q.open.toFixed(2)),
        high: parseFloat(q.high.toFixed(2)),
        low: parseFloat(q.low.toFixed(2)),
        close: parseFloat(q.close.toFixed(2)),
        volume: q.volume || 0,
      });
    }

    // Sort ascending by time
    const candles = Array.from(candleMap.values()).sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      return String(a.time).localeCompare(String(b.time));
    });

    if (candles.length === 0) {
      return res.status(404).json({ error: `Data unavailable for ${symbol}` });
    }

    // Return the latest requested slice
    const sliced = candles.slice(-outputsize);
    setCache(cacheKey, sliced);
    res.json(sliced);
  } catch (err) {
    console.error(`Candles error for ${symbol} (${yfInterval}):`, err.message);
    res.status(502).json({ error: `Data unavailable for ${symbol}`, details: err.message });
  }
});

/**
 * GET /api/search?q=Tata
 */
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query || query.trim().length < 1) {
    return res.json([]);
  }

  const cacheKey = `search_${query.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const searchRes = await yf.search(query.trim());
    if (!searchRes || !searchRes.quotes) return res.json([]);

    // Filter to Indian NSE/BSE securities primarily, or equity instruments
    const results = searchRes.quotes
      .filter(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO') || q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchDisp === 'NSE' || q.exchDisp === 'BSE' || q.symbol.startsWith('^')))
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType || 'Equity',
        exchange: q.exchDisp || (q.symbol.endsWith('.BO') ? 'BSE' : 'NSE'),
        country: 'India',
      }));

    // If no direct .NS found, include top generic search results with normalized .NS
    if (results.length === 0 && searchRes.quotes.length > 0) {
      searchRes.quotes.slice(0, 5).forEach(q => {
        results.push({
          symbol: q.symbol,
          name: q.shortname || q.longname || q.symbol,
          type: q.quoteType || 'Equity',
          exchange: q.exchDisp || 'NSE',
          country: 'India',
        });
      });
    }

    setCache(cacheKey, results);
    res.json(results);
  } catch (err) {
    console.error(`Search error for "${query}":`, err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

/**
 * GET /api/movers
 * Calculates real-time Top Gainers & Decliners from Indian active equities
 */
app.get('/api/movers', async (req, res) => {
  const cacheKey = 'indian_movers';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const symbolsToFetch = INDIAN_ACTIVE_STOCKS.slice(0, 18);
  const quotePromises = symbolsToFetch.map(async sym => {
    try {
      const q = await yf.quote(sym);
      if (q && q.regularMarketPrice != null && q.regularMarketChangePercent != null) {
        return {
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
          price: parseFloat(q.regularMarketPrice.toFixed(2)),
          change: parseFloat((q.regularMarketChange || 0).toFixed(2)),
          percentChange: parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
          volume: q.regularMarketVolume || 0,
          exchange: 'NSE',
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  });

  const quoteResults = await Promise.all(quotePromises);
  const quotes = quoteResults.filter(Boolean);

  if (quotes.length === 0) {
    return res.status(502).json({ error: 'Market movers data temporarily unavailable' });
  }

  // Sort by highest percent change
  const sorted = [...quotes].sort((a, b) => b.percentChange - a.percentChange);
  const gainers = sorted.filter(s => s.percentChange > 0).slice(0, 8);
  const losers = [...quotes].sort((a, b) => a.percentChange - b.percentChange).filter(s => s.percentChange < 0).slice(0, 8);
  const allMovers = [...quotes].sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange)).slice(0, 10);

  const payload = {
    gainers,
    losers,
    allMovers,
    timestampIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' }) + ' IST',
  };

  setCache(cacheKey, payload);
  res.json(payload);
});

// ==========================================
// PERSISTENT HISTORY ENDPOINTS
// ==========================================

/**
 * GET /api/history
 */
app.get('/api/history', (req, res) => {
  try {
    const history = storage.getHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve history', details: err.message });
  }
});

/**
 * POST /api/history
 */
app.post('/api/history', (req, res) => {
  try {
    const record = req.body;
    if (!record || !record.symbol) {
      return res.status(400).json({ error: 'Symbol is required to record history' });
    }

    const saved = storage.addHistoryRecord(record);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save history record', details: err.message });
  }
});

/**
 * DELETE /api/history/:id
 */
app.delete('/api/history/:id', (req, res) => {
  try {
    const success = storage.deleteHistoryRecord(req.params.id);
    if (success) {
      res.json({ message: 'Record deleted successfully', id: req.params.id });
    } else {
      res.status(404).json({ error: 'Record not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record', details: err.message });
  }
});

/**
 * DELETE /api/history (Clear all)
 */
app.delete('/api/history', (req, res) => {
  try {
    storage.clearHistory();
    res.json({ message: 'History cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history', details: err.message });
  }
});

// SPA Fallback
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 K-Delta Indian Stock Market Terminal Server Online`);
  console.log(`📡 Local URL: http://localhost:${PORT}`);
  console.log(`🇮🇳 Market Timezone: Asia/Kolkata (IST)`);
  console.log(`⏰ Trading Hours: 09:15 – 15:30 IST (Mon–Fri)`);
  console.log(`====================================================`);
});

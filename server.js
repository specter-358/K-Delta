/* ============================================================
   K-Delta — Institutional Indian Stock Market Backend Server
   Real-Time Data Engine (NSE/BSE), WebSocket Streaming & Storage
   ============================================================ */

require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const storage = require('./data/storage');
const { provider, normalizeSymbol } = require('./data/marketProvider');
const { wsHub } = require('./data/wsHub');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize WebSocket Streaming Engine
wsHub.init(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

  const weekday = map.weekday;
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

// ==========================================
// REST API ROUTES
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

  try {
    const quote = await provider.getQuote(rawSymbol);
    if (!quote) {
      return res.status(404).json({ error: `Data unavailable for symbol: ${rawSymbol}` });
    }
    res.json(quote);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch quote for ${rawSymbol}`, details: err.message });
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
    const q = await provider.getQuote(sym);
    if (q) results.push(q);
  }

  res.json(results);
});

/**
 * GET /api/market/indices
 */
app.get('/api/market/indices', async (req, res) => {
  try {
    const indices = await provider.getMarketIndices();
    res.json(indices || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch indices', details: err.message });
  }
});

/**
 * GET /api/candles?symbol=RELIANCE.NS&interval=1d&outputsize=120
 */
app.get('/api/candles', async (req, res) => {
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
    res.status(502).json({ error: `Failed to fetch candles for ${rawSymbol}`, details: err.message });
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

  try {
    const results = await provider.searchSymbols(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

/**
 * GET /api/movers
 */
app.get('/api/movers', async (req, res) => {
  try {
    const movers = await provider.getMarketMovers();
    if (!movers) {
      return res.status(502).json({ error: 'Market movers temporarily unavailable' });
    }
    res.json(movers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movers', details: err.message });
  }
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
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 K-Delta Institutional Indian Market Server Online`);
  console.log(`📡 Local Web URL: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket Stream: ws://localhost:${PORT}/ws`);
  console.log(`🇮🇳 Market Timezone: Asia/Kolkata (IST)`);
  console.log(`⏰ Trading Hours: 09:15 – 15:30 IST (Mon–Fri)`);
  console.log(`====================================================`);
});

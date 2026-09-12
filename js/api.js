/* ============================================================
   K-Delta — Real-Time Indian Market API & WebSocket Client
   Communicates directly with backend proxy (NSE/BSE real data)
   ============================================================ */

const API = (() => {
  const cache = new Map();
  let ws = null;
  let wsReconnectTimer = null;
  let currentSubscribedSymbol = null;
  let currentSubscribedTimeframe = '1day';

  const tickCallbacks = new Set();
  const candleUpdateCallbacks = new Set();
  const candleClosedCallbacks = new Set();
  const connectionCallbacks = new Set();

  /**
   * Initialize and manage WebSocket connection
   */
  function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connectionCallbacks.forEach(cb => cb(true));
        if (currentSubscribedSymbol) {
          subscribeSymbol(currentSubscribedSymbol, currentSubscribedTimeframe);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tick') {
            tickCallbacks.forEach(cb => cb(msg.data));
          } else if (msg.type === 'candle_update') {
            candleUpdateCallbacks.forEach(cb => cb(msg));
          } else if (msg.type === 'candle_closed') {
            candleClosedCallbacks.forEach(cb => cb(msg));
          }
        } catch (err) {
          console.warn('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        connectionCallbacks.forEach(cb => cb(false));
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(initWebSocket, 3000);
      };

      ws.onerror = (err) => {
        console.warn('WS error:', err);
        if (ws) ws.close();
      };
    } catch (e) {
      console.warn('WebSocket init error:', e);
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(initWebSocket, 4000);
    }
  }

  function subscribeSymbol(symbol, timeframe = '1day') {
    currentSubscribedSymbol = symbol;
    currentSubscribedTimeframe = timeframe;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: 'subscribe',
        symbol,
        timeframe,
      }));
    }
  }

  function unsubscribeSymbol(symbol) {
    if (ws && ws.readyState === WebSocket.OPEN && symbol) {
      ws.send(JSON.stringify({
        action: 'unsubscribe',
        symbol,
      }));
    }
    if (currentSubscribedSymbol === symbol) {
      currentSubscribedSymbol = null;
    }
  }

  function onTick(callback) {
    tickCallbacks.add(callback);
    return () => tickCallbacks.delete(callback);
  }

  function onCandleUpdate(callback) {
    candleUpdateCallbacks.add(callback);
    return () => candleUpdateCallbacks.delete(callback);
  }

  function onCandleClosed(callback) {
    candleClosedCallbacks.add(callback);
    return () => candleClosedCallbacks.delete(callback);
  }

  function onConnectionChange(callback) {
    connectionCallbacks.add(callback);
    return () => connectionCallbacks.delete(callback);
  }

  // Auto connect WS on load
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      initWebSocket();
    });
  }

  /**
   * Internal fetch with caching & Auth header
   */
  async function apiFetch(endpoint, params = {}, options = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${CONFIG.API_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;
    const cacheKey = url;

    // Check client-side memory cache if method is GET
    if (!options.method || options.method === 'GET') {
      const cached = cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CONFIG.CACHE_DURATION) {
        return cached.data;
      }
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const token = localStorage.getItem('kdelta_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fetchOpts = {
      ...options,
      headers,
    };

    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!options.method || options.method === 'GET') {
      cache.set(cacheKey, { data, timestamp: Date.now() });
    }
    return data;
  }

  /**
   * Fetch market status from backend (calculated in IST Asia/Kolkata)
   */
  async function fetchMarketStatus() {
    try {
      return await apiFetch('/api/market/status');
    } catch (err) {
      console.error('fetchMarketStatus error:', err);
      return {
        isOpen: isMarketOpen(),
        statusText: isMarketOpen() ? 'NSE / BSE — Market Open' : 'NSE / BSE — Market Closed',
        exchange: 'NSE / BSE',
        currentTimeIST: formatISTTime(),
        tradingHours: '09:15 – 15:30 IST (Mon–Fri)',
      };
    }
  }

  /**
   * Fetch candlestick (OHLCV) data for an Indian symbol
   * @param {string} symbol - e.g. 'RELIANCE.NS', 'TCS.NS', '^NSEI'
   * @param {string} interval - e.g. '1min', '3min', '5min', '15min', '30min', '1h', '1day', '1week'
   * @param {number} outputsize - Number of candle data points
   */
  async function fetchCandles(symbol, interval = '1day', outputsize = 120) {
    try {
      const data = await apiFetch('/api/candles', {
        symbol,
        interval,
        outputsize,
      });

      if (!Array.isArray(data) || data.length === 0) {
        console.warn('No candle data returned for', symbol);
        return [];
      }

      return data;
    } catch (err) {
      console.error(`fetchCandles(${symbol}) error:`, err);
      return [];
    }
  }

  /**
   * Fetch real quote for an Indian symbol
   */
  async function fetchQuote(symbol) {
    try {
      const data = await apiFetch('/api/quote', { symbol });
      return data;
    } catch (err) {
      console.error(`fetchQuote(${symbol}) error:`, err);
      return {
        symbol,
        name: symbol,
        price: null,
        change: null,
        percentChange: null,
        volume: null,
        exchange: symbol.endsWith('.BO') ? 'BSE' : 'NSE',
        error: 'Data unavailable',
      };
    }
  }

  /**
   * Fetch multiple quotes in batch
   */
  async function fetchMultipleQuotes(symbols) {
    if (!symbols || symbols.length === 0) return [];
    try {
      const symbolStr = symbols.join(',');
      const data = await apiFetch('/api/quotes', { symbols: symbolStr });
      return Array.isArray(data) ? data : [data];
    } catch (err) {
      console.error('fetchMultipleQuotes error:', err);
      return [];
    }
  }

  /**
   * Fetch real Indian market indices (NIFTY 50, SENSEX, BANK NIFTY, NIFTY IT, INDIA VIX)
   */
  async function fetchMarketIndices() {
    try {
      const data = await apiFetch('/api/market/indices');
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('fetchMarketIndices error:', err);
      return [];
    }
  }

  /**
   * Fetch top market movers (real-time gainers & decliners across NSE)
   */
  async function fetchMovers() {
    try {
      return await apiFetch('/api/movers');
    } catch (err) {
      console.error('fetchMovers error:', err);
      return { gainers: [], losers: [], allMovers: [] };
    }
  }

  /**
   * Search Indian symbols (NSE/BSE)
   */
  async function searchSymbol(query) {
    if (!query || query.trim().length < 1) return [];
    try {
      const data = await apiFetch('/api/search', { q: query.trim() });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('searchSymbol error:', err);
      return [];
    }
  }

  /**
   * Watchlist API Methods
   */
  async function fetchWatchlist() {
    try {
      const response = await fetch('/api/watchlist');
      if (!response.ok) throw new Error('Failed to load watchlist');
      const data = await response.json();
      if (Array.isArray(data)) {
        localStorage.setItem('kdelta_watchlist', JSON.stringify(data));
        return data;
      }
      return getWatchlist();
    } catch (err) {
      console.warn('fetchWatchlist error (using local storage):', err);
      return getWatchlist();
    }
  }

  async function syncWatchlist(symbols) {
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      if (!response.ok) throw new Error('Failed to sync watchlist');
      return await response.json();
    } catch (err) {
      console.warn('syncWatchlist error:', err);
      return symbols;
    }
  }

  async function addToWatchlistAPI(symbol) {
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('addToWatchlistAPI error:', err);
    }
    return addToWatchlist(symbol);
  }

  async function removeFromWatchlistAPI(symbol) {
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('removeFromWatchlistAPI error:', err);
    }
    return removeFromWatchlist(symbol);
  }

  /**
   * Fetch all quotes for the rolling ticker strip
   */
  async function fetchRollingTickerQuotes() {
    try {
      const symbols = CONFIG.ROLLING_TICKER_SYMBOLS || [
        '^NSEI', '^BSESN', '^NSEBANK', '^CNXIT', '^INDIAVIX',
        'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS', 'BHARTIARTL.NS'
      ];

      // Split into indices and equities
      const indexSymbols = symbols.filter(s => s.startsWith('^'));
      const equitySymbols = symbols.filter(s => !s.startsWith('^'));

      const [indices, equities] = await Promise.all([
        fetchMarketIndices().catch(() => []),
        fetchMultipleQuotes(equitySymbols).catch(() => []),
      ]);

      const map = new Map();
      indices.forEach(idx => map.set(idx.symbol, idx));
      equities.forEach(eq => map.set(eq.symbol, eq));

      // Return ordered list
      const combined = [];
      for (const sym of symbols) {
        if (map.has(sym)) {
          combined.push(map.get(sym));
        }
      }
      return combined.length > 0 ? combined : indices;
    } catch (err) {
      console.warn('fetchRollingTickerQuotes error:', err);
      return [];
    }
  }

  // Public API
  return {
    initWebSocket,
    subscribeSymbol,
    unsubscribeSymbol,
    onTick,
    onCandleUpdate,
    onCandleClosed,
    onConnectionChange,
    fetchMarketStatus,
    fetchCandles,
    fetchQuote,
    fetchMultipleQuotes,
    fetchMarketIndices,
    fetchMovers,
    searchSymbol,
    fetchWatchlist,
    syncWatchlist,
    addToWatchlistAPI,
    removeFromWatchlistAPI,
    fetchRollingTickerQuotes,
  };
})();

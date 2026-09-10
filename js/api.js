/* ============================================================
   K-Delta — Real-Time Indian Market API Client
   Communicates directly with backend proxy (NSE/BSE real data)
   Zero mock data, 100% genuine market feed
   ============================================================ */

const API = (() => {
  const cache = new Map();

  /**
   * Internal fetch with caching
   */
  async function apiFetch(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${CONFIG.API_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;
    const cacheKey = url;

    // Check client-side memory cache
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CONFIG.CACHE_DURATION) {
      return cached.data;
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    cache.set(cacheKey, { data, timestamp: Date.now() });
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
   * @param {string} interval - e.g. '1min', '5min', '15min', '1h', '1day', '1week'
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
   * History API Methods
   */
  async function fetchHistory() {
    try {
      const response = await fetch('/api/history');
      if (!response.ok) throw new Error('Failed to load history');
      return await response.json();
    } catch (err) {
      console.error('fetchHistory error:', err);
      return [];
    }
  }

  async function saveHistoryRecord(record) {
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (!response.ok) throw new Error('Failed to save history record');
      return await response.json();
    } catch (err) {
      console.error('saveHistoryRecord error:', err);
      return null;
    }
  }

  async function deleteHistoryRecord(id) {
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (err) {
      console.error('deleteHistoryRecord error:', err);
      return false;
    }
  }

  async function clearAllHistory() {
    try {
      const response = await fetch('/api/history', {
        method: 'DELETE',
      });
      return response.ok;
    } catch (err) {
      console.error('clearAllHistory error:', err);
      return false;
    }
  }

  // Public API
  return {
    fetchMarketStatus,
    fetchCandles,
    fetchQuote,
    fetchMultipleQuotes,
    fetchMarketIndices,
    fetchMovers,
    searchSymbol,
    fetchHistory,
    saveHistoryRecord,
    deleteHistoryRecord,
    clearAllHistory,
  };
})();

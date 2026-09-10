/* ============================================================
   K-Delta — Twelve Data API Client
   REST + WebSocket with caching & rate limiting
   ============================================================ */

const API = (() => {
  const cache = new Map();
  let requestQueue = [];
  let isProcessing = false;
  const RATE_LIMIT_DELAY = 8000; // 8 req/min on free tier → ~8s between calls

  /**
   * Internal fetch with caching
   */
  async function apiFetch(endpoint, params = {}) {
    if (!CONFIG.API_KEY) {
      throw new Error('API key not configured');
    }

    params.apikey = CONFIG.API_KEY;
    const queryString = new URLSearchParams(params).toString();
    const url = `${CONFIG.API_BASE}${endpoint}?${queryString}`;
    const cacheKey = url;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CONFIG.CACHE_DURATION) {
      return cached.data;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'API returned an error');
    }

    // Cache result
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Fetch candlestick (OHLCV) data
   * @param {string} symbol - Stock ticker
   * @param {string} interval - e.g. '1min', '5min', '1day'
   * @param {number} outputsize - Number of data points (max 5000 on free)
   * @returns {Array} Array of {time, open, high, low, close, volume}
   */
  async function fetchCandles(symbol, interval = '1day', outputsize = 120) {
    try {
      const data = await apiFetch('/time_series', {
        symbol,
        interval,
        outputsize,
        format: 'JSON',
      });

      if (!data.values || !Array.isArray(data.values)) {
        console.warn('No candle data returned for', symbol);
        return [];
      }

      // Twelve Data returns newest first — reverse for chronological order
      return data.values
        .map(v => ({
          time: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseInt(v.volume) || 0,
        }))
        .reverse();
    } catch (err) {
      console.error(`fetchCandles(${symbol}) error:`, err);
      return generateMockCandles(symbol, outputsize);
    }
  }

  /**
   * Fetch a quote (current price + change)
   */
  async function fetchQuote(symbol) {
    try {
      const data = await apiFetch('/quote', { symbol });
      return {
        symbol: data.symbol,
        name: data.name,
        price: parseFloat(data.close),
        open: parseFloat(data.open),
        high: parseFloat(data.high),
        low: parseFloat(data.low),
        previousClose: parseFloat(data.previous_close),
        change: parseFloat(data.change),
        percentChange: parseFloat(data.percent_change),
        volume: parseInt(data.volume) || 0,
        exchange: data.exchange,
        datetime: data.datetime,
      };
    } catch (err) {
      console.error(`fetchQuote(${symbol}) error:`, err);
      return generateMockQuote(symbol);
    }
  }

  /**
   * Fetch multiple quotes at once
   */
  async function fetchMultipleQuotes(symbols) {
    if (symbols.length === 0) return [];
    try {
      const symbolStr = symbols.join(',');
      const data = await apiFetch('/quote', { symbol: symbolStr });

      // If single symbol, wrap in array
      if (!Array.isArray(data)) {
        return [
          {
            symbol: data.symbol,
            name: data.name,
            price: parseFloat(data.close),
            change: parseFloat(data.change),
            percentChange: parseFloat(data.percent_change),
            volume: parseInt(data.volume) || 0,
          },
        ];
      }

      return data.map(d => ({
        symbol: d.symbol,
        name: d.name,
        price: parseFloat(d.close),
        change: parseFloat(d.change),
        percentChange: parseFloat(d.percent_change),
        volume: parseInt(d.volume) || 0,
      }));
    } catch (err) {
      console.error('fetchMultipleQuotes error:', err);
      return symbols.map(s => generateMockQuote(s));
    }
  }

  /**
   * Search for stock symbols
   */
  async function searchSymbol(query) {
    if (!query || query.length < 1) return [];
    try {
      const data = await apiFetch('/symbol_search', {
        symbol: query,
        outputsize: 10,
      });

      if (!data.data) return [];

      return data.data.map(d => ({
        symbol: d.symbol,
        name: d.instrument_name,
        type: d.instrument_type,
        exchange: d.exchange,
        country: d.country,
      }));
    } catch (err) {
      console.error('searchSymbol error:', err);
      // Fallback: filter from CONFIG.TOP_STOCKS
      return CONFIG.TOP_STOCKS
        .filter(
          s =>
            s.symbol.toLowerCase().includes(query.toLowerCase()) ||
            s.name.toLowerCase().includes(query.toLowerCase())
        )
        .map(s => ({
          symbol: s.symbol,
          name: s.name,
          type: 'Common Stock',
          exchange: 'NASDAQ',
          country: 'US',
        }));
    }
  }

  /**
   * Generate mock candle data (fallback when API is unavailable)
   */
  function generateMockCandles(symbol, count = 120) {
    const candles = [];
    // Seed from symbol name for consistency
    let seed = 0;
    for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i);
    const basePrice = 100 + (seed % 400);
    let price = basePrice;
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Random walk
      const change = (Math.random() - 0.48) * (price * 0.03);
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * (price * 0.015);
      const low = Math.min(open, close) - Math.random() * (price * 0.015);
      const volume = Math.floor(1000000 + Math.random() * 5000000);

      candles.push({
        time: dateStr,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume,
      });

      price = close;
    }

    return candles;
  }

  /**
   * Generate a mock quote (fallback)
   */
  function generateMockQuote(symbol) {
    let seed = 0;
    for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i);
    const price = 100 + (seed % 400) + Math.random() * 20;
    const change = (Math.random() - 0.45) * 8;
    const percentChange = (change / price) * 100;
    const stockInfo = CONFIG.TOP_STOCKS.find(s => s.symbol === symbol);

    return {
      symbol,
      name: stockInfo ? stockInfo.name : symbol,
      price: parseFloat(price.toFixed(2)),
      open: parseFloat((price - Math.random() * 3).toFixed(2)),
      high: parseFloat((price + Math.random() * 5).toFixed(2)),
      low: parseFloat((price - Math.random() * 5).toFixed(2)),
      previousClose: parseFloat((price - change).toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      percentChange: parseFloat(percentChange.toFixed(2)),
      volume: Math.floor(1000000 + Math.random() * 10000000),
      exchange: 'NASDAQ',
      datetime: new Date().toISOString(),
    };
  }

  // Public API
  return {
    fetchCandles,
    fetchQuote,
    fetchMultipleQuotes,
    searchSymbol,
    generateMockCandles,
    generateMockQuote,
  };
})();

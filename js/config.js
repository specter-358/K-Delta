/* ============================================================
   K-Delta — Configuration
   ============================================================ */

const CONFIG = {
  // Twelve Data API
  API_BASE: 'https://api.twelvedata.com',
  API_KEY: localStorage.getItem('kdelta_api_key') || '',
  WS_URL: 'wss://ws.twelvedata.com/v1/quotes/price',

  // Default stocks for the watchlist
  DEFAULT_WATCHLIST: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX'],

  // Market indices for overview
  MARKET_INDICES: [
    { symbol: 'SPX', name: 'S&P 500', exchange: 'NYSE' },
    { symbol: 'IXIC', name: 'NASDAQ', exchange: 'NASDAQ' },
    { symbol: 'DJI', name: 'Dow Jones', exchange: 'NYSE' },
  ],

  // Top stocks for movers (used when API data unavailable)
  TOP_STOCKS: [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corp.' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'TSLA', name: 'Tesla Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.' },
    { symbol: 'META', name: 'Meta Platforms' },
    { symbol: 'NFLX', name: 'Netflix Inc.' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'V', name: 'Visa Inc.' },
    { symbol: 'WMT', name: 'Walmart Inc.' },
    { symbol: 'DIS', name: 'Walt Disney Co.' },
  ],

  // Available timeframes
  TIMEFRAMES: [
    { label: '1m', value: '1min' },
    { label: '5m', value: '5min' },
    { label: '15m', value: '15min' },
    { label: '1h', value: '1h' },
    { label: '1D', value: '1day' },
    { label: '1W', value: '1week' },
  ],

  // Default timeframe
  DEFAULT_TIMEFRAME: '1day',

  // Cache duration (ms)
  CACHE_DURATION: 60000, // 1 minute

  // Max recent stocks
  MAX_RECENT: 8,

  // US market hours (Eastern Time)
  MARKET_OPEN_HOUR: 9,
  MARKET_OPEN_MIN: 30,
  MARKET_CLOSE_HOUR: 16,
  MARKET_CLOSE_MIN: 0,
};

/**
 * Set and persist the API key
 */
function setApiKey(key) {
  CONFIG.API_KEY = key.trim();
  localStorage.setItem('kdelta_api_key', CONFIG.API_KEY);
}

/**
 * Check if API key is configured
 */
function hasApiKey() {
  return CONFIG.API_KEY && CONFIG.API_KEY.length > 0;
}

/**
 * Get recently visited stocks from localStorage
 */
function getRecentStocks() {
  try {
    return JSON.parse(localStorage.getItem('kdelta_recent') || '[]');
  } catch {
    return [];
  }
}

/**
 * Add a stock to recent visits
 */
function addRecentStock(symbol, name) {
  const recent = getRecentStocks().filter(s => s.symbol !== symbol);
  recent.unshift({ symbol, name, timestamp: Date.now() });
  if (recent.length > CONFIG.MAX_RECENT) recent.pop();
  localStorage.setItem('kdelta_recent', JSON.stringify(recent));
}

/**
 * Get watchlist from localStorage
 */
function getWatchlist() {
  try {
    const saved = localStorage.getItem('kdelta_watchlist');
    return saved ? JSON.parse(saved) : [...CONFIG.DEFAULT_WATCHLIST];
  } catch {
    return [...CONFIG.DEFAULT_WATCHLIST];
  }
}

/**
 * Save watchlist
 */
function saveWatchlist(list) {
  localStorage.setItem('kdelta_watchlist', JSON.stringify(list));
}

/**
 * Check if US market is currently open
 */
function isMarketOpen() {
  const now = new Date();
  // Convert to Eastern Time (approximate — doesn't handle DST perfectly)
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const etHour = (utcHour - 5 + 24) % 24; // EST offset
  const day = now.getUTCDay();

  // Weekdays only
  if (day === 0 || day === 6) return false;

  const currentMinutes = etHour * 60 + utcMin;
  const openMinutes = CONFIG.MARKET_OPEN_HOUR * 60 + CONFIG.MARKET_OPEN_MIN;
  const closeMinutes = CONFIG.MARKET_CLOSE_HOUR * 60 + CONFIG.MARKET_CLOSE_MIN;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/**
 * Format a number as currency
 */
function formatPrice(price) {
  if (price == null || isNaN(price)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

/**
 * Format percent change
 */
function formatPercent(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format change value
 */
function formatChange(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

/**
 * Get CSS class for price direction
 */
function priceClass(change) {
  if (change > 0) return 'price-up';
  if (change < 0) return 'price-down';
  return 'price-neutral';
}

/**
 * Time ago string
 */
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

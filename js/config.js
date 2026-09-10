/* ============================================================
   K-Delta — Indian Stock Market Configuration
   Exchange Hours (NSE/BSE), IST Timezone, Watchlists & Currency
   ============================================================ */

const CONFIG = {
  // Backend API Base URL
  API_BASE: '', // Relative URL routes to Express backend on the same origin

  // Default Indian stocks for the watchlist
  DEFAULT_WATCHLIST: [
    'RELIANCE.NS',
    'TCS.NS',
    'HDFCBANK.NS',
    'INFY.NS',
    'ICICIBANK.NS',
    'SBIN.NS',
    'BHARTIARTL.NS',
    'TATAMOTORS.NS',
  ],

  // Indian Market Indices
  MARKET_INDICES: [
    { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE' },
    { symbol: '^BSESN', name: 'SENSEX', exchange: 'BSE' },
    { symbol: '^NSEBANK', name: 'BANK NIFTY', exchange: 'NSE' },
    { symbol: '^CNXIT', name: 'NIFTY IT', exchange: 'NSE' },
    { symbol: '^INDIAVIX', name: 'INDIA VIX', exchange: 'NSE' },
  ],

  // Top Indian liquid equities
  TOP_STOCKS: [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.' },
    { symbol: 'INFY.NS', name: 'Infosys Ltd.' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd.' },
    { symbol: 'SBIN.NS', name: 'State Bank of India' },
    { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd.' },
    { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd.' },
    { symbol: 'ITC.NS', name: 'ITC Ltd.' },
    { symbol: 'LT.NS', name: 'Larsen & Toubro Ltd.' },
    { symbol: 'MARUTI.NS', name: 'Maruti Suzuki India' },
    { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical' },
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
  CACHE_DURATION: 15000, // 15 seconds

  // Max recent stocks
  MAX_RECENT: 8,

  // Indian market hours (Asia/Kolkata IST)
  MARKET_OPEN_HOUR: 9,
  MARKET_OPEN_MIN: 15,
  MARKET_CLOSE_HOUR: 15,
  MARKET_CLOSE_MIN: 30,
};

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
 * Save watchlist to localStorage
 */
function saveWatchlist(list) {
  localStorage.setItem('kdelta_watchlist', JSON.stringify(list));
}

/**
 * Add symbol to watchlist
 */
function addToWatchlist(symbol) {
  const list = getWatchlist();
  if (!list.includes(symbol)) {
    list.push(symbol);
    saveWatchlist(list);
  }
}

/**
 * Remove symbol from watchlist
 */
function removeFromWatchlist(symbol) {
  const list = getWatchlist().filter(s => s !== symbol);
  saveWatchlist(list);
}

/**
 * Check if Indian market is currently open (Asia/Kolkata timezone)
 */
function isMarketOpen() {
  const now = new Date();
  const istStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const ist = new Date(istStr);
  const day = ist.getDay();

  // Weekend check
  if (day === 0 || day === 6) return false;

  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  const openMinutes = CONFIG.MARKET_OPEN_HOUR * 60 + CONFIG.MARKET_OPEN_MIN; // 09:15 -> 555
  const closeMinutes = CONFIG.MARKET_CLOSE_HOUR * 60 + CONFIG.MARKET_CLOSE_MIN; // 15:30 -> 930

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/**
 * Format timestamp into Indian Standard Time (IST)
 */
function formatISTTime(date = new Date()) {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: true,
  }) + ' IST';
}

/**
 * Format a number as Indian Rupee currency (₹)
 */
function formatPrice(price) {
  if (price == null || isNaN(price)) return 'Data unavailable';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
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

/* ═════════════════════════════════════════════════════════════
   THEME MANAGEMENT (LOCKED DARK INTERFACE)
   ═════════════════════════════════════════════════════════════ */

/**
 * Get saved theme preference - Always Dark Interface
 */
function getSavedTheme() {
  return 'dark';
}

/**
 * Apply dark theme to document and chart
 */
function applyTheme(theme = 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  if (document.body) document.body.classList.add('dark-theme');
  localStorage.setItem('kdelta_theme', 'dark');

  // Update chart if initialized
  if (typeof ChartManager !== 'undefined' && ChartManager.updateTheme) {
    ChartManager.updateTheme('dark');
  }
}

/**
 * Initialize dark theme on page load
 */
function initTheme() {
  applyTheme('dark');
}

// Run immediately
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
});

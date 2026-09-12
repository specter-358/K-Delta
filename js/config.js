/* ============================================================
   K-Delta — Indian Stock Market Configuration
   Exchange Hours (NSE/BSE), IST Timezone, Watchlists & Currency
   ============================================================ */

const CONFIG = {
  // Backend API Base URL
  API_BASE: '', // Relative URL routes to Express backend on the same origin

  // Default Indian stocks for the watchlist (empty by default)
  DEFAULT_WATCHLIST: [],

  // List of market & sectoral index symbols for the scrolling header ticker tape
  ROLLING_TICKER_SYMBOLS: [
    '^NSEI',
    '^BSESN',
    '^NSEBANK',
    '^CNXIT',
    '^INDIAVIX',
    '^CNXAUTO',
    '^CNXFMCG',
    '^CNXPHARMA',
    '^CNXMETAL',
    '^CNXPSUBANK',
    '^CNXREALTY',
    '^CNXFIN',
    '^CNXMEDIA',
    '^CNXCOMMODITIES',
    '^CNX100',
    '^CNX500',
    '^NSEMDCP100',
    '^CNXSMALLCAP',
    '^NSEMDCP50',
    '^NIFTYMIDCAP150',
    '^NIFTYSMLCAP250',
    '^NSEMDCPSEL',
    '^NIFTYTOTALMKT',
    '^BSEBANK',
    '^BSEMID',
    '^BSESML',
    '^BSE100',
    '^BSEIT',
    '^BSEIPO',
    '^NIFTYPVTBANK',
  ],

  // Indian Market & Sectoral Indices
  MARKET_INDICES: [
    { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE' },
    { symbol: '^BSESN', name: 'BSE Sensex', exchange: 'BSE' },
    { symbol: '^NSEBANK', name: 'NIFTY Bank', exchange: 'NSE' },
    { symbol: '^CNXIT', name: 'NIFTY IT', exchange: 'NSE' },
    { symbol: '^INDIAVIX', name: 'India Vix', exchange: 'NSE' },
    { symbol: '^CNXAUTO', name: 'NIFTY Auto', exchange: 'NSE' },
    { symbol: '^CNXFMCG', name: 'Nifty FMCG', exchange: 'NSE' },
    { symbol: '^CNXPHARMA', name: 'NIFTY Pharma', exchange: 'NSE' },
    { symbol: '^CNXMETAL', name: 'NIFTY Metal', exchange: 'NSE' },
    { symbol: '^CNXPSUBANK', name: 'NIFTY PSU Bank', exchange: 'NSE' },
    { symbol: '^CNXREALTY', name: 'NIFTY Realty', exchange: 'NSE' },
    { symbol: '^CNXFIN', name: 'Nifty Financial Services', exchange: 'NSE' },
    { symbol: '^CNXMEDIA', name: 'Nifty Media Index', exchange: 'NSE' },
    { symbol: '^CNXCOMMODITIES', name: 'NIFTY Commodities', exchange: 'NSE' },
    { symbol: '^CNX100', name: 'NIFTY 100', exchange: 'NSE' },
    { symbol: '^CNX500', name: 'NIFTY 500', exchange: 'NSE' },
    { symbol: '^NSEMDCP100', name: 'NIFTY Midcap 100', exchange: 'NSE' },
    { symbol: '^CNXSMALLCAP', name: 'NIFTY Smallcap 100', exchange: 'NSE' },
    { symbol: '^NSEMDCP50', name: 'NIFTY MIDCAP 50', exchange: 'NSE' },
    { symbol: '^NIFTYMIDCAP150', name: 'NIFTY MIDCAP 150', exchange: 'NSE' },
    { symbol: '^NIFTYSMLCAP250', name: 'NIFTY SMALLCAP 250', exchange: 'NSE' },
    { symbol: '^NSEMDCPSEL', name: 'Nifty Midcap Select', exchange: 'NSE' },
    { symbol: '^NIFTYTOTALMKT', name: 'Nifty Total Market', exchange: 'NSE' },
    { symbol: '^BSEBANK', name: 'Bse Bankex', exchange: 'BSE' },
    { symbol: '^BSEMID', name: 'Bse Midcap', exchange: 'BSE' },
    { symbol: '^BSESML', name: 'Bse Smallcap', exchange: 'BSE' },
    { symbol: '^BSE100', name: 'Bse 100', exchange: 'BSE' },
    { symbol: '^BSEIT', name: 'BSE FOCUSED IT', exchange: 'BSE' },
    { symbol: '^BSEIPO', name: 'Bse IPO', exchange: 'BSE' },
    { symbol: '^NIFTYPVTBANK', name: 'NIFTY Private Bank', exchange: 'NSE' },
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
    { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance Ltd.' },
    { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever' },
    { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank' },
    { symbol: 'AXISBANK.NS', name: 'Axis Bank Ltd.' },
    { symbol: 'ASIANPAINT.NS', name: 'Asian Paints Ltd.' },
    { symbol: 'TITAN.NS', name: 'Titan Company Ltd.' },
  ],

  // Available timeframes
  TIMEFRAMES: [
    { label: '1m', value: '1min' },
    { label: '3m', value: '3min' },
    { label: '5m', value: '5min' },
    { label: '15m', value: '15min' },
    { label: '30m', value: '30min' },
    { label: '1h', value: '1h' },
    { label: '1D', value: '1day' },
    { label: '1W', value: '1week' },
  ],

  // Default timeframe
  DEFAULT_TIMEFRAME: '1day',

  // Cache duration (ms)
  CACHE_DURATION: 2000, // 2 seconds for fresh market data

  // Max recent stocks
  MAX_RECENT: 8,

  // Indian market hours (Asia/Kolkata IST)
  MARKET_OPEN_HOUR: 9,
  MARKET_OPEN_MIN: 15,
  MARKET_CLOSE_HOUR: 15,
  MARKET_CLOSE_MIN: 30,
};

/* ═════════════════════════════════════════════════════════════
   STATE PERSISTENCE HELPERS
   ═════════════════════════════════════════════════════════════ */

/**
 * Get saved timeframe / resolution preference
 */
function getSavedTimeframe() {
  try {
    const saved = localStorage.getItem('kdelta_selected_timeframe');
    if (saved && CONFIG.TIMEFRAMES.some(t => t.value === saved)) {
      return saved;
    }
  } catch (e) {}
  return CONFIG.DEFAULT_TIMEFRAME;
}

/**
 * Save selected timeframe / resolution preference
 */
function saveTimeframe(timeframe) {
  try {
    if (timeframe) {
      localStorage.setItem('kdelta_selected_timeframe', timeframe);
    }
  } catch (e) {}
}

/**
 * Get saved last viewed symbol
 */
function getSavedSymbol() {
  try {
    const saved = localStorage.getItem('kdelta_last_symbol');
    if (saved && typeof saved === 'string' && saved.trim().length > 0) {
      return saved.trim().toUpperCase();
    }
  } catch (e) {}
  return 'RELIANCE.NS';
}

/**
 * Save last viewed symbol
 */
function saveSymbol(symbol) {
  try {
    if (symbol) {
      localStorage.setItem('kdelta_last_symbol', symbol.trim().toUpperCase());
    }
  } catch (e) {}
}

/**
 * Get saved inspector tab
 */
function getSavedInspectorTab() {
  try {
    const saved = localStorage.getItem('kdelta_inspector_tab');
    if (saved && ['plan', 'patterns', 'backtest', 'forecast'].includes(saved)) {
      return saved;
    }
  } catch (e) {}
  return 'plan';
}

/**
 * Save active inspector tab
 */
function saveInspectorTab(tab) {
  try {
    if (tab) {
      localStorage.setItem('kdelta_inspector_tab', tab);
    }
  } catch (e) {}
}

/**
 * Get saved sidebar collapse states
 */
function getSavedSidebarStates() {
  try {
    const left = localStorage.getItem('kdelta_left_collapsed') === 'true';
    const right = localStorage.getItem('kdelta_right_collapsed') === 'true';
    return { leftCollapsed: left, rightCollapsed: right };
  } catch (e) {
    return { leftCollapsed: false, rightCollapsed: false };
  }
}

/**
 * Save sidebar collapse states
 */
function saveSidebarStates(leftCollapsed, rightCollapsed) {
  try {
    localStorage.setItem('kdelta_left_collapsed', String(!!leftCollapsed));
    localStorage.setItem('kdelta_right_collapsed', String(!!rightCollapsed));
  } catch (e) {}
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
  try {
    localStorage.setItem('kdelta_recent', JSON.stringify(recent));
  } catch (e) {}
}

/**
 * Get watchlist strictly as saved by user in localStorage / server
 */
function getWatchlist() {
  try {
    const saved = localStorage.getItem('kdelta_watchlist');
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
    return [...CONFIG.DEFAULT_WATCHLIST];
  } catch {
    return [...CONFIG.DEFAULT_WATCHLIST];
  }
}

/**
 * Save watchlist to localStorage and sync with server
 */
function saveWatchlist(list) {
  try {
    const unique = Array.from(new Set(list.map(s => s.trim().toUpperCase()).filter(Boolean)));
    localStorage.setItem('kdelta_watchlist', JSON.stringify(unique));
    if (typeof API !== 'undefined' && API.syncWatchlist) {
      API.syncWatchlist(unique).catch(() => {});
    }
  } catch (e) {}
}

/**
 * Add symbol to watchlist
 */
function addToWatchlist(symbol) {
  if (!symbol) return getWatchlist();
  const cleanSym = symbol.trim().toUpperCase();
  const list = getWatchlist();
  if (!list.includes(cleanSym)) {
    list.push(cleanSym);
    saveWatchlist(list);
  }
  return list;
}

/**
 * Remove symbol from watchlist
 */
function removeFromWatchlist(symbol) {
  if (!symbol) return getWatchlist();
  const cleanSym = symbol.trim().toUpperCase();
  const list = getWatchlist().filter(s => s !== cleanSym);
  saveWatchlist(list);
  return list;
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

/**
 * Format Instrument Display Information
 * Returns { symbolDisplay, nameDisplay, exchangeDisplay, isIndex }
 *
 * Rules:
 * 1. For Indices (e.g. ^NSEI, ^BSESN):
 *    - symbolDisplay: Real Index Name (e.g. 'NIFTY 50', 'BSE Sensex')
 *    - nameDisplay: Exchange ('NSE' or 'BSE')
 *    - exchangeDisplay: Exchange ('NSE' or 'BSE')
 * 2. For Equities / Stocks:
 *    - symbolDisplay: Clean Ticker Symbol (e.g. 'RELIANCE', 'TATASTEEL')
 *    - nameDisplay: Company Full Name (e.g. 'Reliance Industries Ltd.')
 *    - exchangeDisplay: Exchange ('NSE' or 'BSE', never NS/BO/NSI)
 */
function formatInstrumentDisplay(symbol, name, exchange) {
  const sym = symbol ? String(symbol).trim().toUpperCase() : '';
  const isIndex = sym.startsWith('^') || ['NSEI', 'BSESN', 'NSEBANK', 'CNXIT', 'INDIAVIX', 'NIFTY', 'SENSEX', 'BANKNIFTY', 'BSEBANK', 'BSEMID', 'BSESML'].some(k => sym.includes(k));

  const cleanSym = sym.replace('.NS', '').replace('.BO', '').replace('^', '');
  let cleanName = name || cleanSym;

  // Determine correct exchange label (NSE or BSE, never NS/BO/NSI)
  let cleanExchange = 'NSE';
  if (sym.endsWith('.BO') || sym.includes('BSE') || (exchange && String(exchange).toUpperCase().includes('BSE'))) {
    cleanExchange = 'BSE';
  } else {
    cleanExchange = 'NSE';
  }

  if (isIndex) {
    let indexTitle = cleanName;
    if (sym === '^NSEI' || sym === 'NSEI' || cleanSym === 'NSEI') indexTitle = 'NIFTY 50';
    else if (sym === '^BSESN' || sym === 'BSESN' || cleanSym === 'BSESN') indexTitle = 'BSE Sensex';
    else if (sym === '^NSEBANK' || sym === 'NSEBANK' || cleanSym === 'NSEBANK') indexTitle = 'NIFTY Bank';
    else if (sym === '^CNXIT' || sym === 'CNXIT' || cleanSym === 'CNXIT') indexTitle = 'NIFTY IT';
    else if (sym === '^INDIAVIX' || sym === 'INDIAVIX' || cleanSym === 'INDIAVIX') indexTitle = 'India Vix';
    else if (sym === '^CNXAUTO' || cleanSym === 'CNXAUTO') indexTitle = 'NIFTY Auto';
    else if (sym === '^CNXFMCG' || cleanSym === 'CNXFMCG') indexTitle = 'Nifty FMCG';
    else if (sym === '^CNXPHARMA' || cleanSym === 'CNXPHARMA') indexTitle = 'NIFTY Pharma';
    else if (sym === '^CNXMETAL' || cleanSym === 'CNXMETAL') indexTitle = 'NIFTY Metal';
    else if (sym === '^CNXPSUBANK' || cleanSym === 'CNXPSUBANK') indexTitle = 'NIFTY PSU Bank';
    else if (sym === '^CNXREALTY' || cleanSym === 'CNXREALTY') indexTitle = 'NIFTY Realty';
    else if (sym === '^CNXFIN' || cleanSym === 'CNXFIN') indexTitle = 'Nifty Financial Services';
    else if (sym === '^CNXMEDIA' || cleanSym === 'CNXMEDIA') indexTitle = 'Nifty Media Index';
    else if (sym === '^CNXCOMMODITIES' || cleanSym === 'CNXCOMMODITIES') indexTitle = 'NIFTY Commodities';
    else if (sym === '^CNX100' || cleanSym === 'CNX100') indexTitle = 'NIFTY 100';
    else if (sym === '^CNX500' || cleanSym === 'CNX500') indexTitle = 'NIFTY 500';
    else if (sym === '^NSEMDCP100' || cleanSym === 'NSEMDCP100') indexTitle = 'NIFTY Midcap 100';
    else if (sym === '^CNXSMALLCAP' || cleanSym === 'CNXSMALLCAP') indexTitle = 'NIFTY Smallcap 100';
    else if (sym === '^NSEMDCP50' || cleanSym === 'NSEMDCP50') indexTitle = 'NIFTY MIDCAP 50';
    else if (sym === '^NIFTYMIDCAP150' || cleanSym === 'NIFTYMIDCAP150') indexTitle = 'NIFTY MIDCAP 150';
    else if (sym === '^NIFTYSMLCAP250' || cleanSym === 'NIFTYSMLCAP250') indexTitle = 'NIFTY SMALLCAP 250';
    else if (sym === '^NSEMDCPSEL' || cleanSym === 'NSEMDCPSEL') indexTitle = 'Nifty Midcap Select';
    else if (sym === '^NIFTYTOTALMKT' || cleanSym === 'NIFTYTOTALMKT') indexTitle = 'Nifty Total Market';
    else if (sym === '^BSEBANK' || cleanSym === 'BSEBANK') indexTitle = 'Bse Bankex';
    else if (sym === '^BSEMID' || cleanSym === 'BSEMID') indexTitle = 'Bse Midcap';
    else if (sym === '^BSESML' || cleanSym === 'BSESML') indexTitle = 'Bse Smallcap';
    else if (sym === '^BSE100' || cleanSym === 'BSE100') indexTitle = 'Bse 100';
    else if (sym === '^BSEIT' || cleanSym === 'BSEIT') indexTitle = 'BSE FOCUSED IT';
    else if (sym === '^BSEIPO' || cleanSym === 'BSEIPO') indexTitle = 'Bse IPO';
    else if (sym === '^NIFTYPVTBANK' || cleanSym === 'NIFTYPVTBANK') indexTitle = 'NIFTY Private Bank';

    return {
      symbolDisplay: indexTitle,
      nameDisplay: cleanExchange,
      exchangeDisplay: cleanExchange,
      isIndex: true,
    };
  }

  const stockName = (typeof getCleanStockName === 'function' ? getCleanStockName(sym, cleanName) : cleanName);
  return {
    symbolDisplay: cleanSym,
    nameDisplay: stockName,
    exchangeDisplay: cleanExchange,
    isIndex: false,
  };
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
  try {
    localStorage.setItem('kdelta_theme', 'dark');
  } catch (e) {}

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

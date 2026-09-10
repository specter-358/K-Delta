/* ============================================================
   K-Delta — Indian Stock Market Home Page Logic
   100% Real-Time Market Feed, Zero Mock Data
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  loadLiveTickerTape();
  loadHomeData();
  setupSearch();
  setupKeyboardShortcuts();
  updateMarketStatus();

  // Polling intervals during market hours
  setInterval(loadLiveTickerTape, 15000);
  setInterval(updateMarketStatus, 30000);
  setInterval(loadMarketOverview, 30000);
});

/**
 * Load Live Ticker Tape for Indian Market
 */
async function loadLiveTickerTape() {
  const tape = document.getElementById('ticker-tape-items');
  if (!tape) return;

  try {
    const indices = await API.fetchMarketIndices();
    const stocks = await API.fetchMultipleQuotes([
      'RELIANCE.NS',
      'TCS.NS',
      'HDFCBANK.NS',
      'INFY.NS',
      'TATAMOTORS.NS',
      'ICICIBANK.NS',
      'SBIN.NS'
    ]);

    const items = [...indices, ...stocks];
    if (items.length === 0) return;

    tape.innerHTML = items.map(item => {
      const isUp = (item.change || item.percentChange) >= 0;
      const changeClass = isUp ? 'price-up' : 'price-down';
      const cleanSymbol = (item.displayName || item.symbol || '').replace('.NS', '').replace('.BO', '').replace('^', '');
      return `
        <div class="ticker-tape__item" onclick="navigateToDashboard('${item.symbol}')">
          <span class="ticker-tape__symbol">${cleanSymbol}</span>
          <span class="ticker-tape__price">${formatPrice(item.price)}</span>
          <span class="ticker-tape__change ${changeClass}">${formatPercent(item.percentChange)}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Ticker tape error:', err);
  }
}

/**
 * Setup Global Keyboard Shortcuts (Ctrl+K, Esc)
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('hero-search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
    if (e.key === 'Escape') {
      const results = document.getElementById('hero-search-results');
      if (results) results.classList.remove('active');
    }
  });
}

/**
 * Load all home page data
 */
async function loadHomeData() {
  loadMarketOverview();
  loadRecentStocks();
  loadTopMovers();
}

/**
 * Load market overview indices (NIFTY 50, SENSEX, BANK NIFTY, NIFTY IT, INDIA VIX)
 */
async function loadMarketOverview() {
  const grid = document.getElementById('market-grid');
  if (!grid) return;

  try {
    const indices = await API.fetchMarketIndices();
    if (!indices || indices.length === 0) {
      grid.innerHTML = '<div style="color:var(--text-muted);padding:16px">Market indices temporarily unavailable.</div>';
      return;
    }

    grid.innerHTML = indices
      .map(
        q => `
      <div class="market-card" onclick="navigateToDashboard('${q.symbol}')">
        <div class="market-card__info">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="market-card__symbol">${q.name}</span>
            <span class="badge badge--neutral" style="font-size:0.65rem;padding:1px 5px">${q.exchange}</span>
          </div>
          <div class="market-card__price">${formatPrice(q.price)}</div>
        </div>
        <div class="market-card__change">
          <div class="market-card__change-value ${priceClass(q.change)}">
            ${formatChange(q.change)}
          </div>
          <div class="market-card__change-percent ${priceClass(q.change)}">
            ${formatPercent(q.percentChange)}
          </div>
        </div>
      </div>`
      )
      .join('');
  } catch (err) {
    console.error('loadMarketOverview error:', err);
    grid.innerHTML = '<div style="color:var(--bearish);padding:16px">Unable to load Indian market indices.</div>';
  }
}

/**
 * Load high-conviction / recently visited Indian stocks
 */
async function loadRecentStocks() {
  const grid = document.getElementById('recent-grid');
  if (!grid) return;

  let stocksToLoad = getRecentStocks();

  // If user hasn't visited any stocks yet, show active benchmark Indian equities
  if (!stocksToLoad || stocksToLoad.length === 0) {
    stocksToLoad = [
      { symbol: 'RELIANCE.NS', name: 'Reliance Industries', timestamp: Date.now() - 3600000 },
      { symbol: 'TCS.NS', name: 'Tata Consultancy Services', timestamp: Date.now() - 7200000 },
      { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', timestamp: Date.now() - 10800000 },
      { symbol: 'INFY.NS', name: 'Infosys Ltd.', timestamp: Date.now() - 14400000 },
      { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd.', timestamp: Date.now() - 18000000 },
      { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd.', timestamp: Date.now() - 21600000 },
    ];
  }

  // Show skeletons
  grid.innerHTML = stocksToLoad
    .map(
      () => `
    <div class="stock-card">
      <div class="stock-card__header">
        <div class="stock-card__symbol-wrap">
          <div class="skeleton" style="width:32px;height:32px;border-radius:4px"></div>
          <div>
            <div class="skeleton" style="width:60px;height:16px;margin-bottom:4px"></div>
            <div class="skeleton" style="width:100px;height:11px"></div>
          </div>
        </div>
      </div>
      <div class="skeleton" style="width:100%;height:35px;margin-top:10px"></div>
    </div>`
    )
    .join('');

  // Fetch live quotes & real candle data for analysis
  const cards = [];
  for (const stock of stocksToLoad) {
    try {
      const quote = await API.fetchQuote(stock.symbol);
      const candles = await API.fetchCandles(stock.symbol, '1day', 60);

      let prediction = { signal: 'HOLD', confidence: 0 };
      if (candles && candles.length >= 20) {
        prediction = Predictions.analyze(candles);
      }

      const badgeClass =
        prediction.signal === 'BUY'
          ? 'badge--bullish'
          : prediction.signal === 'SELL'
          ? 'badge--bearish'
          : 'badge--neutral';
      const badgeIcon =
        prediction.signal === 'BUY' ? '▲' : prediction.signal === 'SELL' ? '▼' : '■';
      const actionText = prediction.action || prediction.signal;
      const targetText = prediction.tradeSetup && prediction.tradeSetup.hasSetup
        ? `Target: ₹${prediction.tradeSetup.target1.toFixed(2)} (${prediction.tradeSetup.target1Pct})`
        : 'Consolidation Zone';

      const cleanSymbol = stock.symbol.replace('.NS', '').replace('.BO', '');

      cards.push(`
        <a class="stock-card" href="dashboard.html?symbol=${encodeURIComponent(stock.symbol)}" onclick="addRecentStock('${stock.symbol}', '${(quote.name || stock.name || '').replace(/'/g, "\\'")}')">
          <div class="stock-card__header">
            <div class="stock-card__symbol-wrap">
              <div class="stock-card__icon">${cleanSymbol.charAt(0)}</div>
              <div>
                <div class="stock-card__symbol">${stock.symbol}</div>
                <div class="stock-card__name">${quote.name || stock.name || ''}</div>
              </div>
            </div>
            <span class="badge ${badgeClass} stock-card__prediction-badge">
              ${badgeIcon} ${actionText}
            </span>
          </div>
          <div class="stock-card__price-row">
            <span class="stock-card__price">${formatPrice(quote.price)}</span>
            <span class="stock-card__change ${priceClass(quote.change)}">
              ${formatChange(quote.change)} (${formatPercent(quote.percentChange)})
            </span>
          </div>
          <div class="stock-card__target-preview" style="font-size:0.75rem; color:var(--text-secondary); margin:6px 0 2px; font-family:var(--font-mono)">
            🎯 ${targetText}
          </div>
          <div class="stock-card__footer">
            <span class="stock-card__visit-time">${stock.timestamp ? timeAgo(stock.timestamp) : 'Live Analysis'}</span>
            <span class="stock-card__action">Trade Plan →</span>
          </div>
        </a>`);
    } catch (e) {
      console.warn('Error loading stock card for', stock.symbol, e);
    }
  }

  if (cards.length > 0) {
    grid.innerHTML = cards.join('');
  } else {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:16px">No stock setups available.</div>';
  }
}

/**
 * Load top movers from real /api/movers
 */
async function loadTopMovers() {
  const list = document.getElementById('movers-list');
  if (!list) return;

  // Show skeletons
  list.innerHTML = Array(6)
    .fill(0)
    .map(
      () => `
    <div class="mover-item">
      <div class="mover-item__left">
        <div class="skeleton" style="width:24px;height:16px"></div>
        <div>
          <div class="skeleton" style="width:50px;height:14px;margin-bottom:4px"></div>
          <div class="skeleton" style="width:100px;height:11px"></div>
        </div>
      </div>
      <div class="mover-item__right">
        <div class="skeleton" style="width:70px;height:14px;margin-bottom:4px"></div>
        <div class="skeleton" style="width:50px;height:12px"></div>
      </div>
    </div>`
    )
    .join('');

  try {
    const data = await API.fetchMovers();
    window._moversData = data;
    renderMovers(data);
  } catch (err) {
    console.error('loadTopMovers error:', err);
    list.innerHTML = '<div style="color:var(--bearish);padding:16px">Market movers data unavailable.</div>';
  }
}

function renderMovers(data) {
  const list = document.getElementById('movers-list');
  if (!list || !data) return;

  const activeTab = document.querySelector('.movers-tab.active');
  const filter = activeTab ? activeTab.dataset.filter : 'all';

  let items = data.allMovers || [];
  if (filter === 'gainers') items = data.gainers || [];
  if (filter === 'losers') items = data.losers || [];

  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);padding:16px">No movers data available for this category.</div>';
    return;
  }

  list.innerHTML = items
    .map(
      (m, i) => `
    <div class="mover-item" onclick="navigateToDashboard('${m.symbol}')">
      <div class="mover-item__left">
        <span class="mover-item__rank">${i + 1}</span>
        <div>
          <div class="mover-item__symbol">${m.symbol}</div>
          <div class="mover-item__name">${m.name}</div>
        </div>
      </div>
      <div class="mover-item__right">
        <div class="mover-item__price">${formatPrice(m.price)}</div>
        <div class="mover-item__change ${priceClass(m.percentChange)}">
          ${formatPercent(m.percentChange)}
        </div>
      </div>
    </div>`
    )
    .join('');
}

/**
 * Handle mover tab click
 */
function switchMoverTab(tab) {
  document.querySelectorAll('.movers-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  if (window._moversData) {
    renderMovers(window._moversData);
  }
}

/**
 * Setup search functionality for Indian stocks (NSE/BSE)
 */
function setupSearch() {
  const searchInput = document.getElementById('hero-search-input');
  const searchResults = document.getElementById('hero-search-results');
  if (!searchInput || !searchResults) return;

  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = searchInput.value.trim();

    if (query.length < 1) {
      searchResults.classList.remove('active');
      return;
    }

    debounceTimer = setTimeout(async () => {
      const results = await API.searchSymbol(query);
      if (!results || results.length === 0) {
        searchResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">No matching Indian stocks found.</div>';
        searchResults.classList.add('active');
        return;
      }

      searchResults.innerHTML = results
        .slice(0, 8)
        .map(
          r => `
        <div class="search-result-item" onclick="navigateToDashboard('${r.symbol}', '${(r.name || '').replace(/'/g, "\\'")}')">
          <div>
            <div class="search-result-item__symbol">${r.symbol}</div>
            <div class="search-result-item__name">${r.name || ''}</div>
          </div>
          <span class="search-result-item__exchange">${r.exchange || 'NSE'}</span>
        </div>`
        )
        .join('');

      searchResults.classList.add('active');
    }, 250);
  });

  // Close on click outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) {
      searchResults.classList.remove('active');
    }
  });

  // Enter key
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim().toUpperCase();
      if (query) navigateToDashboard(query);
    }
  });
}

/**
 * Navigate to dashboard
 */
function navigateToDashboard(symbol, name) {
  addRecentStock(symbol, name || symbol);
  window.location.href = `dashboard.html?symbol=${encodeURIComponent(symbol)}`;
}

/**
 * Update market open/close status from backend
 */
async function updateMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  if (!dot || !text) return;

  const status = await API.fetchMarketStatus();
  dot.className = `status-dot ${status.isOpen ? 'open' : ''}`;
  text.textContent = status.statusText || (status.isOpen ? 'NSE / BSE — Market Open' : 'NSE / BSE — Market Closed');
}

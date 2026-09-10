/* ============================================================
   K-Delta — Home Page Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ── Check API Key ──
  if (!hasApiKey()) {
    showApiSetup();
  } else {
    hideApiSetup();
    loadHomeData();
  }

  // ── Setup Search ──
  setupSearch();

  // ── Setup Market Status ──
  updateMarketStatus();
  setInterval(updateMarketStatus, 30000);
});

/**
 * Show API key setup card
 */
function showApiSetup() {
  const setupEl = document.getElementById('api-setup');
  if (setupEl) setupEl.classList.remove('hidden');
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.add('hidden');
}

function hideApiSetup() {
  const setupEl = document.getElementById('api-setup');
  if (setupEl) setupEl.classList.add('hidden');
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.remove('hidden');
}

/**
 * Handle API key submission
 */
function submitApiKey() {
  const input = document.getElementById('api-key-input');
  const key = input.value.trim();
  if (!key) {
    showToast('Please enter a valid API key', 'error');
    return;
  }
  setApiKey(key);
  hideApiSetup();
  loadHomeData();
  showToast('API key saved successfully!', 'success');
}

/**
 * Skip API setup (use mock data)
 */
function skipApiSetup() {
  hideApiSetup();
  loadHomeData();
  showToast('Using demo data. Add API key anytime in settings.', 'info');
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
 * Load market overview indices
 */
async function loadMarketOverview() {
  const grid = document.getElementById('market-grid');
  if (!grid) return;

  // Show skeletons
  grid.innerHTML = CONFIG.MARKET_INDICES.map(
    () => `
    <div class="market-card">
      <div class="market-card__info">
        <div class="skeleton" style="width:60px;height:14px;margin-bottom:6px"></div>
        <div class="skeleton" style="width:100px;height:12px"></div>
      </div>
      <div class="market-card__change">
        <div class="skeleton" style="width:80px;height:20px;margin-bottom:4px"></div>
        <div class="skeleton" style="width:60px;height:14px"></div>
      </div>
    </div>`
  ).join('');

  // Fetch data for top stocks (indices often need special access)
  const symbols = ['AAPL', 'MSFT', 'GOOGL'];
  const names = { AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', GOOGL: 'Alphabet Inc.' };

  const quotes = [];
  for (const sym of symbols) {
    const q = await API.fetchQuote(sym);
    quotes.push(q);
  }

  grid.innerHTML = quotes
    .map(
      q => `
    <div class="market-card" onclick="navigateToDashboard('${q.symbol}')">
      <div class="market-card__info">
        <div class="market-card__symbol">${q.symbol}</div>
        <div class="market-card__name">${q.name || names[q.symbol] || q.symbol}</div>
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
}

/**
 * Load recently visited stocks
 */
async function loadRecentStocks() {
  const grid = document.getElementById('recent-grid');
  const section = document.getElementById('recent-section');
  if (!grid) return;

  const recentStocks = getRecentStocks();

  if (recentStocks.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">No Recent Stocks</div>
        <div class="empty-state__text">Search for a stock above to start analyzing candlestick patterns and predictions.</div>
      </div>`;
    return;
  }

  // Show skeletons
  grid.innerHTML = recentStocks
    .map(
      () => `
    <div class="stock-card">
      <div class="stock-card__header">
        <div class="stock-card__symbol-wrap">
          <div class="skeleton" style="width:36px;height:36px;border-radius:6px"></div>
          <div>
            <div class="skeleton" style="width:60px;height:16px;margin-bottom:4px"></div>
            <div class="skeleton" style="width:100px;height:11px"></div>
          </div>
        </div>
      </div>
      <div class="skeleton" style="width:100%;height:40px;margin-top:12px"></div>
    </div>`
    )
    .join('');

  // Fetch live data for recent stocks
  const cards = [];
  for (const stock of recentStocks) {
    const quote = await API.fetchQuote(stock.symbol);
    // Quick prediction from recent candles
    const candles = await API.fetchCandles(stock.symbol, '1day', 60);
    let prediction = { signal: 'HOLD', confidence: 0 };
    if (candles.length >= 30) {
      prediction = Predictions.analyze(candles);
    }

    const badgeClass =
      prediction.signal === 'BUY'
        ? 'badge--bullish'
        : prediction.signal === 'SELL'
        ? 'badge--bearish'
        : 'badge--neutral';
    const badgeIcon =
      prediction.signal === 'BUY' ? '🟢' : prediction.signal === 'SELL' ? '🔴' : '🟡';

    cards.push(`
      <a class="stock-card" href="dashboard.html?symbol=${stock.symbol}" onclick="addRecentStock('${stock.symbol}', '${(quote.name || stock.name || '').replace(/'/g, "\\'")}')">
        <div class="stock-card__header">
          <div class="stock-card__symbol-wrap">
            <div class="stock-card__icon">${stock.symbol.charAt(0)}</div>
            <div>
              <div class="stock-card__symbol">${stock.symbol}</div>
              <div class="stock-card__name">${quote.name || stock.name || ''}</div>
            </div>
          </div>
          <span class="badge ${badgeClass} stock-card__prediction-badge">
            ${badgeIcon} ${prediction.signal}
          </span>
        </div>
        <div class="stock-card__price-row">
          <span class="stock-card__price">${formatPrice(quote.price)}</span>
          <span class="stock-card__change ${priceClass(quote.change)}">
            ${formatChange(quote.change)} (${formatPercent(quote.percentChange)})
          </span>
        </div>
        <div class="stock-card__footer">
          <span class="stock-card__visit-time">Visited ${timeAgo(stock.timestamp)}</span>
          <span class="stock-card__action">Analyze →</span>
        </div>
      </a>`);
  }

  grid.innerHTML = cards.join('');
}

/**
 * Load top movers
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

  // Fetch quotes for top stocks
  const movers = [];
  for (const stock of CONFIG.TOP_STOCKS.slice(0, 8)) {
    const q = await API.fetchQuote(stock.symbol);
    movers.push({ ...stock, ...q });
  }

  // Sort by absolute percent change
  movers.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));

  // Apply current tab filter
  renderMovers(movers);
}

function renderMovers(movers) {
  const list = document.getElementById('movers-list');
  if (!list) return;

  const activeTab = document.querySelector('.movers-tab.active');
  const filter = activeTab ? activeTab.dataset.filter : 'all';

  let filtered = movers;
  if (filter === 'gainers') filtered = movers.filter(m => m.percentChange > 0);
  if (filter === 'losers') filtered = movers.filter(m => m.percentChange < 0);

  list.innerHTML = filtered
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

  // Store movers for tab switching
  window._moversData = movers;
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
 * Setup search functionality
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
      if (results.length === 0) {
        searchResults.classList.remove('active');
        return;
      }

      searchResults.innerHTML = results
        .map(
          r => `
        <div class="search-result-item" onclick="navigateToDashboard('${r.symbol}', '${(r.name || '').replace(/'/g, "\\'")}')">
          <div>
            <div class="search-result-item__symbol">${r.symbol}</div>
            <div class="search-result-item__name">${r.name || ''}</div>
          </div>
          <span class="search-result-item__exchange">${r.exchange || ''}</span>
        </div>`
        )
        .join('');

      searchResults.classList.add('active');
    }, 300);
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
 * Update market open/close status
 */
function updateMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  if (!dot || !text) return;

  const open = isMarketOpen();
  dot.className = `status-dot ${open ? 'open' : ''}`;
  text.textContent = open ? 'Market Open' : 'Market Closed';
}

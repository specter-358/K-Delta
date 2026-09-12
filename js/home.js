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
 * Load Continuous Rolling Market Ticker Tape (20+ Indices & Equities)
 */
async function loadLiveTickerTape() {
  const tape = document.getElementById('ticker-tape-items');
  if (!tape) return;

  try {
    const quotes = await API.fetchRollingTickerQuotes();
    if (!quotes || quotes.length === 0) return;

    const renderItems = (itemsList) => itemsList.map(item => {
      const isUp = (item.change || item.percentChange) >= 0;
      const changeClass = isUp ? 'price-up' : 'price-down';
      const displayInfo = formatInstrumentDisplay(item.symbol, item.displayName || item.name, item.exchange);

      return `
        <div class="ticker-tape__item" onclick="navigateToDashboard('${item.symbol}', '${(displayInfo.symbolDisplay).replace(/'/g, "\\'")}')">
          <span class="ticker-tape__symbol">${displayInfo.symbolDisplay}</span>
          <span class="ticker-tape__price">${formatPrice(item.price)}</span>
          <span class="ticker-tape__change ${changeClass}">${formatPercent(item.percentChange)}</span>
        </div>
      `;
    }).join('');

    // Duplicate list once to allow infinite seamless marquee scroll
    tape.innerHTML = renderItems(quotes) + renderItems(quotes);
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
      const searchResults = document.getElementById('hero-search-results');
      if (searchResults) searchResults.classList.remove('active');
    }
  });
}

/**
 * Load all Home Page Real-Time Data (No dummy numbers)
 */
async function loadHomeData() {
  await Promise.all([
    loadMarketOverview(),
    loadRecentSetups(),
    loadTopMovers(),
  ]);
}

/**
 * Load Indian Market Indices Overview
 */
async function loadMarketOverview() {
  const grid = document.getElementById('market-grid');
  const extraGrid = document.getElementById('market-grid-extra');
  const toggleWrap = document.getElementById('indices-view-more-wrap');
  if (!grid) return;

  if (!grid.children.length) {
    grid.innerHTML = Array(5).fill('<div class="market-card skeleton" style="height:90px"></div>').join('');
  }

  try {
    const indices = await API.fetchMarketIndices();
    if (!indices || indices.length === 0) {
      grid.innerHTML = '<div style="color:var(--text-muted);padding:16px">Market indices currently updating.</div>';
      return;
    }

    const renderCard = (idx) => {
      const isUp = (idx.change || idx.percentChange) >= 0;
      const changeClass = isUp ? 'price-up' : 'price-down';
      const displayInfo = formatInstrumentDisplay(idx.symbol, idx.name, idx.exchange);
      return `
        <div class="market-card" onclick="navigateToDashboard('${idx.symbol}', '${(displayInfo.symbolDisplay).replace(/'/g, "\\'")}')">
          <div>
            <div class="market-card__symbol">${displayInfo.symbolDisplay}</div>
            <div class="market-card__price">${formatPrice(idx.price)}</div>
          </div>
          <div class="market-card__change ${changeClass}">
            <div class="market-card__change-value">${formatChange(idx.change)}</div>
            <div class="market-card__change-percent">(${formatPercent(idx.percentChange)})</div>
          </div>
        </div>
      `;
    };

    const firstRow = indices.slice(0, 5);
    const extraRows = indices.slice(5);

    grid.innerHTML = firstRow.map(renderCard).join('');

    if (extraGrid) {
      extraGrid.innerHTML = extraRows.map(renderCard).join('');
    }

    if (toggleWrap) {
      toggleWrap.style.display = extraRows.length > 0 ? 'block' : 'none';
    }
  } catch (err) {
    console.error('Market overview error:', err);
    grid.innerHTML = '<div style="color:var(--text-muted);padding:16px">Failed to load index data.</div>';
  }
}

/**
 * Toggle Visibility of Extra Sector Indices
 */
function toggleSectorIndices() {
  const extraGrid = document.getElementById('market-grid-extra');
  const btnLabel = document.querySelector('#toggle-indices-btn span:first-child');
  const icon = document.getElementById('toggle-indices-icon');
  if (!extraGrid || !btnLabel || !icon) return;

  const isHidden = extraGrid.style.display === 'none' || !extraGrid.style.display;
  if (isHidden) {
    extraGrid.style.display = 'grid';
    btnLabel.textContent = 'View Less Sector Indices';
    icon.textContent = '▴';
  } else {
    extraGrid.style.display = 'none';
    btnLabel.textContent = 'View More Sector Indices';
    icon.textContent = '▾';
  }
}

/**
 * Load Live High-Conviction Technical Setups for Indian Equities
 */
async function loadRecentSetups() {
  const grid = document.getElementById('recent-grid');
  if (!grid) return;

  grid.innerHTML = Array(3).fill('<div class="stock-card skeleton" style="height:190px"></div>').join('');

  const featuredStocks = [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd.' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.' },
  ];

  const cards = [];

  for (const stock of featuredStocks) {
    try {
      const [quote, candles] = await Promise.all([
        API.fetchQuote(stock.symbol),
        API.fetchCandles(stock.symbol, '1day', 70),
      ]);

      if (!quote || !candles || candles.length < 15) continue;

      const prediction = PredictionEngine.analyze(candles, stock.symbol);
      const isBuy = (prediction.signal || '').includes('BUY');
      const isSell = (prediction.signal || '').includes('SELL');
      const badgeClass = isBuy ? 'badge--bullish' : isSell ? 'badge--bearish' : 'badge--neutral';
      const badgeIcon = isBuy ? '▲' : isSell ? '▼' : '■';
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
            ${targetText}
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

  list.innerHTML = Array(6).fill('<div class="mover-item skeleton" style="height:60px"></div>').join('');

  try {
    const moversData = await API.fetchMovers();
    if (!moversData || !moversData.allMovers || moversData.allMovers.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);padding:16px">Market movers data unavailable.</div>';
      return;
    }

    window._moversData = moversData;
    renderMovers(moversData);
  } catch (err) {
    console.error('Movers fetch error:', err);
    list.innerHTML = '<div style="color:var(--text-muted);padding:16px">Failed to load NSE movers.</div>';
  }
}

/**
 * Render movers based on active filter tab
 */
function renderMovers(moversData) {
  const list = document.getElementById('movers-list');
  if (!list) return;

  const activeTab = document.querySelector('.movers-tab.active');
  const filter = activeTab ? activeTab.dataset.filter : 'all';

  let items = [];
  if (filter === 'gainers') items = moversData.gainers || [];
  else if (filter === 'losers') items = moversData.losers || [];
  else items = moversData.allMovers || [];

  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);padding:16px">No mover data for this category.</div>';
    return;
  }

  list.innerHTML = items.map((m, idx) => {
    const isUp = m.percentChange >= 0;
    const changeClass = isUp ? 'price-up' : 'price-down';
    const sign = isUp ? '+' : '';
    const cleanSym = m.symbol.replace('.NS', '').replace('.BO', '');
    return `
      <div class="mover-item" onclick="navigateToDashboard('${m.symbol}', '${(m.name || cleanSym).replace(/'/g, "\\'")}')">
        <div class="mover-item__left">
          <span class="mover-item__rank">${idx + 1}</span>
          <div>
            <div class="mover-item__symbol">${cleanSym}</div>
            <div class="mover-item__name">${m.name || 'NSE Stock'}</div>
          </div>
        </div>
        <div class="mover-item__right">
          <div class="mover-item__price">${formatPrice(m.price)}</div>
          <div class="mover-item__change ${changeClass}">${sign}${m.percentChange.toFixed(2)}%</div>
        </div>
      </div>
    `;
  }).join('');
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
          r => {
            const displayInfo = formatInstrumentDisplay(r.symbol, r.name, r.exchange);
            return `
        <div class="search-result-item" onclick="navigateToDashboard('${r.symbol}', '${(displayInfo.nameDisplay || '').replace(/'/g, "\\'")}')">
          <div>
            <div class="search-result-item__symbol">${displayInfo.symbolDisplay}</div>
            <div class="search-result-item__name">${displayInfo.nameDisplay}</div>
          </div>
          <span class="search-result-item__exchange">${displayInfo.exchangeDisplay}</span>
        </div>`;
          }
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

// Global window bindings
if (typeof window !== 'undefined') {
  window.navigateToDashboard = navigateToDashboard;
}

/* ============================================================
   K-Delta — Watchlist Page Logic
   Persistent stock radar, live quotes, search & add/remove
   ============================================================ */

let watchlistSymbols = [];
let watchlistQuotes = [];
let currentWatchlistFilter = 'ALL';

document.addEventListener('DOMContentLoaded', () => {
  loadLiveTickerTape();
  loadMarketStatus();
  startLiveClock();
  setupWatchlistSearchAdd();
  setupWatchlistFilterInput();
  updateWatchlistPushUI();
  loadWatchlistData();

  // Polling intervals
  setInterval(loadMarketStatus, 20000);
  setInterval(loadLiveTickerTape, 25000);
  setInterval(() => loadWatchlistData(true), 15000);
  setInterval(updateWatchlistPushUI, 5000);
});

/**
 * Start live IST clock in navbar
 */
function startLiveClock() {
  const clockEl = document.getElementById('live-ist-clock');
  function update() {
    if (clockEl) {
      clockEl.textContent = formatISTTime();
    }
  }
  update();
  setInterval(update, 1000);
}

/**
 * Load Continuous Rolling Market Ticker Tape
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
        <div class="ticker-tape__item" onclick="launchTerminal('${item.symbol}')">
          <span class="ticker-tape__symbol">${displayInfo.symbolDisplay}</span>
          <span class="ticker-tape__price">${formatPrice(item.price)}</span>
          <span class="ticker-tape__change ${changeClass}">${formatPercent(item.percentChange)}</span>
        </div>
      `;
    }).join('');

    // Duplicate list once to allow infinite seamless marquee scroll
    tape.innerHTML = renderItems(quotes) + renderItems(quotes);
  } catch (err) {
    console.warn('Ticker tape fetch error:', err);
  }
}

/**
 * Update market status badge
 */
async function loadMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  if (!dot || !text) return;

  const status = await API.fetchMarketStatus();
  dot.className = `status-dot ${status.isOpen ? 'open' : ''}`;
  text.textContent = status.statusText || (status.isOpen ? 'NSE / BSE — Market Open' : 'NSE / BSE — Market Closed');
}

/**
 * Load Watchlist Data from Server & localStorage
 */
async function loadWatchlistData(isBackground = false) {
  const tbody = document.getElementById('watchlist-table-body');
  const emptyState = document.getElementById('watchlist-empty-state');
  if (!tbody) return;

  if (!isBackground && (!watchlistQuotes || watchlistQuotes.length === 0)) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">
          <div class="spinner" style="margin:0 auto 8px"></div>
          Loading persistent watchlist securities...
        </td>
      </tr>
    `;
  }

  try {
    watchlistSymbols = await API.fetchWatchlist();
    if (!watchlistSymbols || !Array.isArray(watchlistSymbols)) {
      watchlistSymbols = getWatchlist();
    }

    if (watchlistSymbols.length === 0) {
      watchlistQuotes = [];
      renderWatchlistTable();
      updateWatchlistStats();
      return;
    }

    // Fetch batch quotes for all symbols
    const quotes = await API.fetchMultipleQuotes(watchlistSymbols);
    
    // Feed quotes to AlertEngine for automatic price movement sound detection
    if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.processPriceUpdate === 'function') {
      quotes.forEach(q => {
        if (q && q.symbol && typeof q.price === 'number') {
          AlertEngine.processPriceUpdate(q.symbol, q.price);
        }
      });
    }

    // Map quotes keeping order of symbols
    const quoteMap = new Map();
    quotes.forEach(q => quoteMap.set(q.symbol, q));

    watchlistQuotes = watchlistSymbols.map(sym => {
      const q = quoteMap.get(sym);
      if (q) return q;
      return {
        symbol: sym,
        name: sym.replace('.NS', '').replace('.BO', '').replace('^', ''),
        price: null,
        change: null,
        percentChange: null,
        open: null,
        high: null,
        low: null,
        volume: 0,
        exchange: sym.endsWith('.BO') || sym === '^BSESN' ? 'BSE' : 'NSE',
      };
    });

    renderWatchlistTable();
    updateWatchlistStats();
  } catch (err) {
    console.error('Failed to load watchlist data:', err);
    if (!isBackground) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center;padding:24px;color:var(--bearish)">
            Failed to refresh watchlist quotes. Please try again.
          </td>
        </tr>
      `;
    }
  }
}

/**
 * Update Summary Statistics Cards
 */
function updateWatchlistStats() {
  const totalEl = document.getElementById('stat-total-count');
  const gainersEl = document.getElementById('stat-gainers-count');
  const gainersPctEl = document.getElementById('stat-gainers-pct');
  const losersEl = document.getElementById('stat-losers-count');
  const losersPctEl = document.getElementById('stat-losers-pct');
  const topMoverEl = document.getElementById('stat-top-mover');
  const topMoverSubEl = document.getElementById('stat-top-mover-sub');

  const total = watchlistQuotes.length;
  if (totalEl) totalEl.textContent = total;

  if (total === 0) {
    if (gainersEl) gainersEl.textContent = '0';
    if (gainersPctEl) gainersPctEl.textContent = '0% of watched';
    if (losersEl) losersEl.textContent = '0';
    if (losersPctEl) losersPctEl.textContent = '0% of watched';
    if (topMoverEl) topMoverEl.textContent = '—';
    if (topMoverSubEl) topMoverSubEl.textContent = 'No active securities';
    return;
  }

  const validQuotes = watchlistQuotes.filter(q => q.percentChange != null);
  const gainers = validQuotes.filter(q => q.percentChange > 0);
  const losers = validQuotes.filter(q => q.percentChange < 0);

  const gainersPct = ((gainers.length / total) * 100).toFixed(0);
  const losersPct = ((losers.length / total) * 100).toFixed(0);

  if (gainersEl) gainersEl.textContent = gainers.length;
  if (gainersPctEl) gainersPctEl.textContent = `${gainersPct}% of watched`;
  if (losersEl) losersEl.textContent = losers.length;
  if (losersPctEl) losersPctEl.textContent = `${losersPct}% of watched`;

  if (validQuotes.length > 0) {
    const sorted = [...validQuotes].sort((a, b) => (b.percentChange || 0) - (a.percentChange || 0));
    const top = sorted[0];
    const isUp = (top.percentChange || 0) >= 0;
    const displayInfo = formatInstrumentDisplay(top.symbol, top.name, top.exchange);

    if (topMoverEl) {
      topMoverEl.className = `stat-card__val ${isUp ? 'price-up' : 'price-down'}`;
      topMoverEl.textContent = `${displayInfo.symbolDisplay} (${formatPercent(top.percentChange)})`;
    }
    if (topMoverSubEl) {
      const subLabel = displayInfo.isIndex ? `${displayInfo.exchangeDisplay} Index` : displayInfo.nameDisplay;
      topMoverSubEl.textContent = `${subLabel} • ${formatPrice(top.price)}`;
    }
  } else {
    if (topMoverEl) topMoverEl.textContent = '—';
  }
}

/**
 * Render Watchlist Table
 */
function renderWatchlistTable() {
  const tbody = document.getElementById('watchlist-table-body');
  const emptyState = document.getElementById('watchlist-empty-state');
  const filterInput = document.getElementById('watchlist-filter-input');
  const query = (filterInput ? filterInput.value : '').trim().toLowerCase();

  if (!tbody) return;

  if (!watchlistQuotes || watchlistQuotes.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  let filtered = [...watchlistQuotes];

  // Category filter
  if (currentWatchlistFilter === 'GAINERS') {
    filtered = filtered.filter(q => (q.percentChange || 0) > 0);
  } else if (currentWatchlistFilter === 'LOSERS') {
    filtered = filtered.filter(q => (q.percentChange || 0) < 0);
  } else if (currentWatchlistFilter === 'INDICES') {
    filtered = filtered.filter(q => q.symbol.startsWith('^'));
  }

  // Text search filter
  if (query) {
    filtered = filtered.filter(q =>
      (q.symbol || '').toLowerCase().includes(query) ||
      (q.name || '').toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">
          No securities match the selected filter.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(q => {
    const isUp = (q.change || q.percentChange) >= 0;
    const changeClass = isUp ? 'price-up' : 'price-down';
    const displayInfo = formatInstrumentDisplay(q.symbol, q.name, q.exchange);

    const firstChar = displayInfo.symbolDisplay ? displayInfo.symbolDisplay.charAt(0) : 'E';

    const rangeText = (q.high != null && q.low != null)
      ? `H: ${q.high.toFixed(1)} / L: ${q.low.toFixed(1)}`
      : '—';

    const volumeText = q.volume
      ? (q.volume > 1000000 ? `${(q.volume / 1000000).toFixed(2)}M` : `${(q.volume / 1000).toFixed(1)}k`)
      : '—';

    const exchangeBadge = displayInfo.isIndex ? `INDEX (${displayInfo.exchangeDisplay})` : displayInfo.exchangeDisplay;

    // Retrieve active algorithmic trade signal and exit targets from AlertEngine
    const signalState = (typeof AlertEngine !== 'undefined' && typeof AlertEngine.getWatchlistSignalState === 'function')
      ? AlertEngine.getWatchlistSignalState(q.symbol)
      : null;

    let signalHtml = '';
    if (signalState && signalState.signal === 'BUY') {
      const entryP = signalState.price ? formatPrice(signalState.price) : (q.price ? formatPrice(q.price) : 'Market');
      const tp = signalState.target1 ? formatPrice(signalState.target1) : '—';
      const sl = signalState.stopLoss ? formatPrice(signalState.stopLoss) : '—';
      signalHtml = `
        <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="High-Conviction BUY Setup. Click to open in terminal.">
          <div class="watchlist-signal-badge badge--buy">
            <span class="signal-dot buy"></span> BUY @ ${entryP}
          </div>
          <div class="watchlist-exit-plan">
            <span class="exit-item exit-tp">Exit TP: <strong>${tp}</strong> (${signalState.target1Pct || '+2.0%'})</span>
            <span class="exit-sep">•</span>
            <span class="exit-item exit-sl">Exit SL: <strong>${sl}</strong> (${signalState.stopLossPct || '-1.5%'})</span>
          </div>
        </div>
      `;
    } else if (signalState && signalState.signal === 'SELL' && !signalState.exitReason) {
      const entryP = signalState.price ? formatPrice(signalState.price) : (q.price ? formatPrice(q.price) : 'Market');
      const tp = signalState.target1 ? formatPrice(signalState.target1) : '—';
      const sl = signalState.stopLoss ? formatPrice(signalState.stopLoss) : '—';
      signalHtml = `
        <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="High-Conviction SELL / SHORT Setup. Click to open in terminal.">
          <div class="watchlist-signal-badge badge--sell">
            <span class="signal-dot sell"></span> SELL @ ${entryP}
          </div>
          <div class="watchlist-exit-plan">
            <span class="exit-item exit-tp">Exit Cover: <strong>${tp}</strong> (${signalState.target1Pct || '-2.0%'})</span>
            <span class="exit-sep">•</span>
            <span class="exit-item exit-sl">Exit SL: <strong>${sl}</strong> (${signalState.stopLossPct || '+1.5%'})</span>
          </div>
        </div>
      `;
    } else if (signalState && (signalState.signal === 'EXIT' || signalState.exitReason)) {
      const exitTitle = signalState.exitReason || signalState.reason || 'Exit Condition Met';
      signalHtml = `
        <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="Position Exit Triggered. Click to view analysis.">
          <div class="watchlist-signal-badge badge--exit">
            <span class="signal-dot exit"></span> EXIT: ${exitTitle}
          </div>
          <div class="watchlist-exit-plan">
            <span class="exit-item" style="color:var(--text-secondary)">Exit Trigger @ ${formatPrice(signalState.price || q.price)}</span>
          </div>
        </div>
      `;
    } else {
      signalHtml = `
        <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="Technical Consolidation. Monitoring for breakout.">
          <div class="watchlist-signal-badge badge--neutral">
            <span class="signal-dot neutral"></span> HOLD / WAIT
          </div>
          <div class="watchlist-exit-plan">
            <span class="exit-item" style="color:var(--text-muted)">Monitoring confluence...</span>
          </div>
        </div>
      `;
    }

    return `
      <tr id="row-${q.symbol.replace(/[^A-Z0-9]/g, '_')}">
        <td>
          <div class="instrument-cell">
            <div class="instrument-icon">${firstChar}</div>
            <div>
              <div class="instrument-symbol">${displayInfo.symbolDisplay}</div>
              <div class="instrument-name">${displayInfo.nameDisplay}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge badge--neutral" style="font-size:0.7rem">${exchangeBadge}</span>
        </td>
        <td class="price-cell">
          ${formatPrice(q.price)}
        </td>
        <td class="${changeClass}" style="font-family:var(--font-mono);font-weight:600">
          ${formatChange(q.change)}
        </td>
        <td class="${changeClass}" style="font-family:var(--font-mono);font-weight:700">
          ${formatPercent(q.percentChange)}
        </td>
        <td class="signal-cell">
          ${signalHtml}
        </td>
        <td class="range-cell">${rangeText}</td>
        <td class="volume-cell">${volumeText}</td>
        <td>
          <span style="font-size:0.74rem;color:var(--text-secondary)">
            <span class="status-dot open" style="width:6px;height:6px"></span> Active
          </span>
        </td>
        <td>
          <div class="actions-cell">
            <button class="btn-table-launch" onclick="launchTerminal('${q.symbol}')" title="Open in Terminal">
              Terminal ↗
            </button>
            <button class="btn-table-alert" onclick="openSymbolAlertModal('${q.symbol}', ${q.price || 0})" title="Set Price Alert for ${displayInfo.symbolDisplay}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            </button>
            <button class="btn-table-del" onclick="handleRemoveSymbol('${q.symbol}')" title="Remove from Watchlist">
              &times;
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Filter watchlist by category pill
 */
function filterWatchlist(filter) {
  currentWatchlistFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderWatchlistTable();
}

/**
 * Setup live text filter input listener
 */
function setupWatchlistFilterInput() {
  const filterInput = document.getElementById('watchlist-filter-input');
  if (!filterInput) return;
  filterInput.addEventListener('input', () => {
    renderWatchlistTable();
  });
}

/**
 * Setup Stock Search & Add Autocomplete Dropdown
 */
function setupWatchlistSearchAdd() {
  const input = document.getElementById('watchlist-add-input');
  const results = document.getElementById('watchlist-add-results');
  if (!input || !results) return;

  let debounceTimer = null;

  const catalog = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.INDIAN_SECURITIES_CATALOG))
    ? CONFIG.INDIAN_SECURITIES_CATALOG
    : [];

  function filterCatalog(query) {
    if (!query) return catalog.slice(0, 8);
    const qClean = query.trim().toLowerCase();
    return catalog.filter(s => {
      const symClean = s.symbol.replace('.NS', '').replace('.BO', '').replace('^', '').toLowerCase();
      return symClean.includes(qClean) || s.symbol.toLowerCase().includes(qClean) || (s.name && s.name.toLowerCase().includes(qClean));
    });
  }

  function renderWatchlistResults(items) {
    if (!items || items.length === 0) {
      results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.75rem">No matching securities found.</div>';
      results.classList.add('active');
      return;
    }

    results.innerHTML = items.slice(0, 6).map(r => {
      const cleanSym = (r.symbol || '').replace('.NS', '').replace('.BO', '').replace('^', '');
      const isAlreadyAdded = watchlistSymbols.includes(r.symbol);

      return `
        <div class="search-result-item" onclick="handleAddSymbol('${r.symbol}')">
          <div style="text-align:left; align-items:flex-start;">
            <div class="search-result-item__symbol" style="text-align:left;">${cleanSym}</div>
            <div class="search-result-item__name" style="text-align:left;">${r.name || cleanSym}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="search-result-item__exchange">${r.exchange || 'NSE'}</span>
            ${isAlreadyAdded ? '<span style="font-size:0.65rem;color:var(--accent-blue);font-weight:700">Added</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    results.classList.add('active');
  }

  // Show popular suggestions on focus or click
  const showSuggestionsOnFocus = () => {
    const q = input.value.trim();
    if (!q) {
      renderWatchlistResults(catalog.slice(0, 8));
    } else {
      renderWatchlistResults(filterCatalog(q));
    }
  };

  input.addEventListener('focus', showSuggestionsOnFocus);
  input.addEventListener('click', showSuggestionsOnFocus);

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 1) {
      renderWatchlistResults(catalog.slice(0, 8));
      return;
    }

    // 1. Instant local filter across Indian catalog (0ms latency)
    const localMatches = filterCatalog(query);
    renderWatchlistResults(localMatches);

    // 2. Debounced live backend search merge
    debounceTimer = setTimeout(async () => {
      try {
        const searchResults = await API.searchSymbol(query);
        if (searchResults && searchResults.length > 0) {
          renderWatchlistResults(searchResults);
        }
      } catch (err) {
        // Keep local matches rendered
      }
    }, 120);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerSearchAdd();
    } else if (e.key === 'Escape') {
      results.classList.remove('active');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.watchlist-search-add')) {
      results.classList.remove('active');
    }
  });
}

/**
 * Handle Add Stock from Input or Button with smart symbol resolution
 */
function triggerSearchAdd() {
  const input = document.getElementById('watchlist-add-input');
  const results = document.getElementById('watchlist-add-results');
  if (!input) return;

  const rawQuery = input.value.trim();
  if (!rawQuery) return;

  const qUpper = rawQuery.toUpperCase();
  const catalog = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.INDIAN_SECURITIES_CATALOG))
    ? CONFIG.INDIAN_SECURITIES_CATALOG
    : [];

  // Check if query matches a symbol in catalog
  let match = catalog.find(s => s.symbol.toUpperCase() === qUpper || s.symbol.replace('.NS', '').replace('.BO', '').replace('^', '').toUpperCase() === qUpper);

  // If not exact symbol, check if name or prefix matches
  if (!match) {
    const qClean = rawQuery.toLowerCase();
    match = catalog.find(s => {
      const symClean = s.symbol.replace('.NS', '').replace('.BO', '').replace('^', '').toLowerCase();
      return symClean.startsWith(qClean) || (s.name && s.name.toLowerCase().startsWith(qClean));
    }) || catalog.find(s => {
      const symClean = s.symbol.replace('.NS', '').replace('.BO', '').replace('^', '').toLowerCase();
      return symClean.includes(qClean) || (s.name && s.name.toLowerCase().includes(qClean));
    });
  }

  let finalSymbol = match ? match.symbol : qUpper;
  if (!finalSymbol.endsWith('.NS') && !finalSymbol.endsWith('.BO') && !finalSymbol.startsWith('^')) {
    finalSymbol = `${finalSymbol}.NS`;
  }

  handleAddSymbol(finalSymbol);
  input.value = '';
  if (results) results.classList.remove('active');
}

/**
 * Add a Symbol to the Watchlist (Prevents Duplicates & Updates Instantly)
 */
async function handleAddSymbol(symbol) {
  if (!symbol) return;
  const cleanSym = symbol.trim().toUpperCase();

  const input = document.getElementById('watchlist-add-input');
  const results = document.getElementById('watchlist-add-results');
  if (input) input.value = '';
  if (results) results.classList.remove('active');

  if (watchlistSymbols.includes(cleanSym)) {
    showToast(`${cleanSym} is already in your watchlist`, 'info');
    return;
  }

  // Update local list immediately for instant UX feedback
  watchlistSymbols.push(cleanSym);
  saveWatchlist(watchlistSymbols);
  if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.checkSymbolSignal === 'function') {
    AlertEngine.checkSymbolSignal(cleanSym);
  }

  showToast(`Added ${cleanSym} to Watchlist`, 'success');

  // Sync with backend API
  API.addToWatchlistAPI(cleanSym).catch(() => {});

  // Fetch updated quotes and re-render
  await loadWatchlistData(true);
}

/**
 * Remove a Symbol from the Watchlist
 */
async function handleRemoveSymbol(symbol) {
  if (!symbol) return;
  const cleanSym = symbol.trim().toUpperCase();

  // Update local list immediately
  watchlistSymbols = watchlistSymbols.filter(s => s !== cleanSym);
  watchlistQuotes = watchlistQuotes.filter(q => q.symbol !== cleanSym);

  // Save to localStorage immediately and unmonitor in AlertEngine
  saveWatchlist(watchlistSymbols);
  if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.unmonitorSymbol === 'function') {
    AlertEngine.unmonitorSymbol(cleanSym);
  }

  renderWatchlistTable();
  updateWatchlistStats();
  showToast(`Removed ${cleanSym} from Watchlist`, 'info');

  // Sync complete list to backend cleanly (prevents race conditions)
  try {
    await API.syncWatchlist(watchlistSymbols);
  } catch (err) {
    console.warn('Backend sync failed on remove:', err);
  }
}

/**
 * Restore Default Watchlist if user wants to reset
 */
async function restoreDefaultWatchlist() {
  watchlistSymbols = [...CONFIG.DEFAULT_WATCHLIST];
  saveWatchlist(watchlistSymbols);
  API.syncWatchlist(watchlistSymbols).catch(() => {});
  showToast('Default watchlist restored', 'success');
  await loadWatchlistData();
}

/**
 * Launch Terminal with selected stock
 */
function launchTerminal(symbol) {
  saveSymbol(symbol);
  window.location.href = `dashboard.html?symbol=${encodeURIComponent(symbol)}`;
}

function openSymbolAlertModal(symbol, price) {
  if (typeof AlertEngine !== 'undefined') {
    AlertEngine.openAlertsCenter();
    setTimeout(() => {
      const symInput = document.getElementById('custom-alert-sym');
      const priceInput = document.getElementById('custom-alert-price');
      if (symInput) symInput.value = symbol;
      if (priceInput && price) priceInput.value = price;
    }, 100);
  }
}

function updateWatchlistPushUI() {
  const dot = document.getElementById('watchlist-push-dot');
  const text = document.getElementById('watchlist-push-text');
  const btn = document.getElementById('btn-enable-push');
  if (!text) return;

  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  if (perm === 'granted') {
    if (dot) dot.className = 'status-dot open';
    text.textContent = 'Desktop Push Active (Buy/Sell Radar)';
    if (btn) btn.style.display = 'none';
  } else if (perm === 'denied') {
    if (dot) dot.className = 'status-dot';
    text.textContent = 'Desktop Push Blocked in Browser';
    if (btn) {
      btn.textContent = 'Notification Settings';
      btn.style.display = 'inline-flex';
    }
  } else {
    if (dot) dot.className = 'status-dot';
    text.textContent = 'Desktop Push Inactive';
    if (btn) {
      btn.textContent = 'Enable Desktop Push';
      btn.style.display = 'inline-flex';
    }
  }
}

async function enableWatchlistPush() {
  if (typeof AlertEngine !== 'undefined') {
    await AlertEngine.requestNotificationPermission();
    updateWatchlistPushUI();
  }
}

function testWatchlistNotification(type = 'BUY') {
  if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.triggerTestNotification === 'function') {
    AlertEngine.triggerTestNotification(type);
  }
}

// Global window bindings
if (typeof window !== 'undefined') {
  window.loadWatchlistData = loadWatchlistData;
  window.filterWatchlist = filterWatchlist;
  window.handleAddSymbol = handleAddSymbol;
  window.handleRemoveSymbol = handleRemoveSymbol;
  window.triggerSearchAdd = triggerSearchAdd;
  window.restoreDefaultWatchlist = restoreDefaultWatchlist;
  window.launchTerminal = launchTerminal;
  window.openSymbolAlertModal = openSymbolAlertModal;
  window.updateWatchlistPushUI = updateWatchlistPushUI;
  window.enableWatchlistPush = enableWatchlistPush;
  window.testWatchlistNotification = testWatchlistNotification;
}

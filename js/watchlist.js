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

  // Subscribe to real-time WebSocket tick stream for zero-latency table price updates
  if (typeof API !== 'undefined' && typeof API.onTick === 'function') {
    API.onTick(tick => {
      if (!tick || !tick.symbol || typeof tick.price !== 'number') return;
      handleLiveTickUpdate(tick);
    });
  }

  // Subscribe to AlertEngine signal updates for instant reactive table updates
  if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.onSignalUpdate === 'function') {
    AlertEngine.onSignalUpdate((symbol) => {
      updateWatchlistSignalCells(symbol);
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('kdelta:watchlist-signal-updated', (e) => {
      const sym = e.detail && e.detail.symbol;
      updateWatchlistSignalCells(sym);
    });
  }

  // Staggered polling intervals with visibilityState suspension
  let watchlistDataTimer = null;
  let tickerTapeTimer = null;
  let marketStatusTimer = null;
  let pushUITimer = null;

  function startTimers() {
    if (!watchlistDataTimer) watchlistDataTimer = setInterval(() => { if (!document.hidden) loadWatchlistData(true); }, 20000);
    if (!tickerTapeTimer) tickerTapeTimer = setInterval(() => { if (!document.hidden) loadLiveTickerTape(); }, 30000);
    if (!marketStatusTimer) marketStatusTimer = setInterval(() => { if (!document.hidden) loadMarketStatus(); }, 40000);
    if (!pushUITimer) pushUITimer = setInterval(() => { if (!document.hidden) updateWatchlistPushUI(); }, 15000);
  }

  function stopTimers() {
    clearInterval(watchlistDataTimer); watchlistDataTimer = null;
    clearInterval(tickerTapeTimer); tickerTapeTimer = null;
    clearInterval(marketStatusTimer); marketStatusTimer = null;
    clearInterval(pushUITimer); pushUITimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimers();
    } else {
      startTimers();
      loadWatchlistData(true);
      loadLiveTickerTape();
      loadMarketStatus();
    }
  });

  startTimers();
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
    // 1. Initialize from local storage if memory is not yet set
    const localSaved = getWatchlist();
    if (!watchlistSymbols || watchlistSymbols.length === 0) {
      if (Array.isArray(localSaved) && localSaved.length > 0) {
        watchlistSymbols = [...localSaved];
      }
    }

    // 2. Fetch authoritative list from backend
    try {
      const serverSymbols = await API.fetchWatchlist();
      if (Array.isArray(serverSymbols) && serverSymbols.length > 0) {
        watchlistSymbols = [...serverSymbols];
      }
    } catch (apiErr) {
      console.warn('API.fetchWatchlist fallback:', apiErr);
    }

    // 3. Fallback to default if still empty
    if (!watchlistSymbols || !Array.isArray(watchlistSymbols) || watchlistSymbols.length === 0) {
      watchlistSymbols = [...(CONFIG.DEFAULT_WATCHLIST || [])];
    }

    if (watchlistSymbols.length === 0) {
      watchlistQuotes = [];
      renderWatchlistTable();
      updateWatchlistStats();
      return;
    }

    // Subscribe WebSocket for live updates
    if (typeof API !== 'undefined' && typeof API.subscribeWatchlistSymbols === 'function') {
      API.subscribeWatchlistSymbols(watchlistSymbols);
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

    // Trigger immediate background algorithmic signal evaluation
    if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.evaluateWatchlistSignals === 'function') {
      AlertEngine.evaluateWatchlistSignals();
    }
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
  if (currentWatchlistFilter === 'BUY') {
    filtered = filtered.filter(q => getWatchlistSignalType(q) === 'BUY');
  } else if (currentWatchlistFilter === 'SELL') {
    filtered = filtered.filter(q => getWatchlistSignalType(q) === 'SELL');
  } else if (currentWatchlistFilter === 'EXIT') {
    filtered = filtered.filter(q => getWatchlistSignalType(q) === 'EXIT');
  } else if (currentWatchlistFilter === 'HOLD') {
    filtered = filtered.filter(q => getWatchlistSignalType(q) === 'HOLD');
  } else if (currentWatchlistFilter === 'GAINERS') {
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

  // Sort so securities with active signals (BUY, SELL, EXIT) are shifted to the upper side (top of list)
  // so the trader can see them early!
  const getSignalPriority = (item) => {
    const sigState = (typeof AlertEngine !== 'undefined' && typeof AlertEngine.getWatchlistSignalState === 'function')
      ? AlertEngine.getWatchlistSignalState(item.symbol)
      : null;
    const type = getWatchlistSignalType(item, sigState);
    if (type === 'BUY') return 1;
    if (type === 'SELL') return 2;
    if (type === 'EXIT') return 3;
    return 4; // HOLD
  };

  filtered.sort((a, b) => {
    const prioA = getSignalPriority(a);
    const prioB = getSignalPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    const pctA = Math.abs(a.percentChange || 0);
    const pctB = Math.abs(b.percentChange || 0);
    return pctB - pctA;
  });

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

    const signalHtml = buildWatchlistSignalHtml(q, signalState);

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
 * Accurately determine whether an instrument is BUY, SELL, or HOLD
 * Based on authentic algorithmic confluence, active alerts, and momentum
 */
function getWatchlistSignalType(q, signalState) {
  if (!signalState && typeof AlertEngine !== 'undefined' && typeof AlertEngine.getWatchlistSignalState === 'function') {
    signalState = AlertEngine.getWatchlistSignalState(q.symbol);
  }

  // 1. Explicit High-Conviction EXIT, BUY or SELL from AlertEngine / PredictionEngine
  if (signalState) {
    const sig = (signalState.signal || '').toUpperCase();
    const act = (signalState.action || '').toUpperCase();

    // Check confirmed EXIT signal first
    if (sig === 'EXIT' || signalState.exitReason || act.startsWith('EXIT')) {
      return 'EXIT';
    }

    // Check confirmed BUY signal (ensure not 'NO BUY' or 'AVOID BUY' or 'HOLD')
    if (
      sig === 'BUY' ||
      (act.includes('BUY') && !act.includes('NO BUY') && !act.includes('AVOID BUY') && !act.includes('HOLD') && !act.includes('WAIT'))
    ) {
      return 'BUY';
    }

    // Check confirmed SELL signal
    if (
      sig === 'SELL' ||
      ((act.includes('SELL') || act.includes('BEAR')) && !act.includes('HOLD') && !act.includes('WAIT'))
    ) {
      return 'SELL';
    }
  }

  // 2. Real-Time Price Action & Directional Momentum
  const pct = (q && typeof q.percentChange === 'number')
    ? q.percentChange
    : ((q && typeof q.change === 'number' && q.price) ? ((q.change / q.price) * 100) : 0);

  // Clear directional momentum thresholds
  if (pct >= 0.8) {
    return 'BUY';
  } else if (pct <= -0.8) {
    return 'SELL';
  } else {
    // Within -0.8% to +0.8%: Consolidation / Range / Neutral -> accurately HOLD
    return 'HOLD';
  }
}

/**
 * Generate Actionable Signal Cell HTML
 * Displays clean, accurate BUY, SELL, EXIT, or HOLD badges.
 * Eliminates bulky, confusing multi-line exit text from table cells.
 */
function buildWatchlistSignalHtml(q, signalState) {
  const currentPriceNum = (signalState && signalState.price)
    ? signalState.price
    : (q && q.price ? q.price : null);

  const signalType = getWatchlistSignalType(q, signalState);
  const entryP = currentPriceNum ? formatPrice(currentPriceNum) : 'Market';

  if (signalType === 'BUY') {
    let target1 = signalState && signalState.target1 ? signalState.target1 : null;
    let stopLoss = signalState && signalState.stopLoss ? signalState.stopLoss : null;
    if (currentPriceNum && currentPriceNum > 0) {
      if (!target1 || target1 <= currentPriceNum) target1 = +(currentPriceNum * 1.025).toFixed(2);
      if (!stopLoss || stopLoss >= currentPriceNum) stopLoss = +(currentPriceNum * 0.985).toFixed(2);
    }
    const tpStr = target1 ? formatPrice(target1) : '—';
    const slStr = stopLoss ? formatPrice(stopLoss) : '—';

    return `
      <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="BUY Signal @ ${entryP} | Target: ${tpStr} | Stop Loss: ${slStr}. Click to open in terminal.">
        <div class="watchlist-signal-badge badge--buy">
          <span class="signal-dot buy"></span> BUY @ ${entryP}
        </div>
      </div>
    `;
  } else if (signalType === 'SELL') {
    let target1 = signalState && signalState.target1 ? signalState.target1 : null;
    let stopLoss = signalState && signalState.stopLoss ? signalState.stopLoss : null;
    if (currentPriceNum && currentPriceNum > 0) {
      if (!target1 || target1 >= currentPriceNum) target1 = +(currentPriceNum * 0.975).toFixed(2);
      if (!stopLoss || stopLoss <= currentPriceNum) stopLoss = +(currentPriceNum * 1.015).toFixed(2);
    }
    const tpStr = target1 ? formatPrice(target1) : '—';
    const slStr = stopLoss ? formatPrice(stopLoss) : '—';

    return `
      <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="SELL Signal @ ${entryP} | Cover Target: ${tpStr} | Stop Loss: ${slStr}. Click to open in terminal.">
        <div class="watchlist-signal-badge badge--sell">
          <span class="signal-dot sell"></span> SELL @ ${entryP}
        </div>
      </div>
    `;
  } else if (signalType === 'EXIT') {
    const exitReasonText = (signalState && (signalState.exitReason || signalState.reason)) || 'Exit target/stop reached';
    return `
      <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="EXIT Signal @ ${entryP} | ${exitReasonText}. Click to open in terminal.">
        <div class="watchlist-signal-badge badge--exit">
          <span class="signal-dot exit"></span> EXIT @ ${entryP}
        </div>
      </div>
    `;
  } else {
    // No active signal (HOLD / Consolidation)
    // Requirement: Only show when there is a signal, otherwise don't show anything (clean muted placeholder)
    if (typeof currentWatchlistFilter !== 'undefined' && currentWatchlistFilter === 'HOLD') {
      return `
        <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="HOLD (Consolidation @ ${entryP}). Click to open in terminal.">
          <div class="watchlist-signal-badge badge--hold">
            <span class="signal-dot hold"></span> HOLD @ ${entryP}
          </div>
        </div>
      `;
    }

    return `
      <div class="watchlist-signal-cell" onclick="launchTerminal('${q.symbol}')" title="No active trade signal (Consolidation @ ${entryP}). Click to open in terminal.">
        <span class="watchlist-no-signal" title="No active signal">—</span>
      </div>
    `;
  }
}

/**
 * Update Individual Signal Cells without refreshing the entire table
 */
function updateWatchlistSignalCells(specificSymbol = null) {
  if (!watchlistQuotes || watchlistQuotes.length === 0) return;
  const list = specificSymbol
    ? watchlistQuotes.filter(q => q.symbol === specificSymbol)
    : watchlistQuotes;

  const tbody = document.getElementById('watchlist-table-body');

  list.forEach(q => {
    const rowId = `row-${q.symbol.replace(/[^A-Z0-9]/g, '_')}`;
    const row = document.getElementById(rowId);
    if (!row) return;
    const cell = row.querySelector('.signal-cell');
    if (!cell) return;
    const signalState = (typeof AlertEngine !== 'undefined' && typeof AlertEngine.getWatchlistSignalState === 'function')
      ? AlertEngine.getWatchlistSignalState(q.symbol)
      : null;
    cell.innerHTML = buildWatchlistSignalHtml(q, signalState);

    // If an active signal occurs, shift it to the upper side so trader sees it early!
    const sigType = getWatchlistSignalType(q, signalState);
    if (sigType === 'BUY' || sigType === 'SELL' || sigType === 'EXIT') {
      if (tbody && tbody.firstChild !== row) {
        tbody.insertBefore(row, tbody.firstChild);
        row.classList.remove('row-promoted-signal');
        void row.offsetWidth;
        row.classList.add('row-promoted-signal');
      }
    }
  });
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

  // 1. Immediately update UI state & local symbols list
  watchlistSymbols.push(cleanSym);

  // 2. Add placeholder quote to watchlistQuotes so it appears immediately in the table
  const displayInfo = formatInstrumentDisplay(cleanSym);
  const placeholderQuote = {
    symbol: cleanSym,
    name: displayInfo.nameDisplay || cleanSym.replace('.NS', '').replace('.BO', ''),
    price: null,
    change: null,
    percentChange: null,
    open: null,
    high: null,
    low: null,
    volume: 0,
    exchange: cleanSym.endsWith('.BO') || cleanSym === '^BSESN' ? 'BSE' : 'NSE',
  };
  watchlistQuotes.push(placeholderQuote);
  renderWatchlistTable();
  updateWatchlistStats();

  showToast(`Added ${cleanSym} to Watchlist`, 'success');

  // 3. Immediately persist locally and monitor in AlertEngine
  try {
    localStorage.setItem('kdelta_watchlist', JSON.stringify(watchlistSymbols));
    if (typeof AlertEngine !== 'undefined') {
      if (typeof AlertEngine.checkSymbolSignal === 'function') {
        AlertEngine.checkSymbolSignal(cleanSym);
      }
      if (typeof AlertEngine.syncWatchlist === 'function') {
        AlertEngine.syncWatchlist();
      }
    }
    if (typeof API !== 'undefined' && typeof API.subscribeWatchlistSymbols === 'function') {
      API.subscribeWatchlistSymbols([cleanSym]);
    }
  } catch (e) {}

  // 4. Synchronize with backend API
  try {
    if (typeof API !== 'undefined') {
      const serverUpdated = await API.syncWatchlist(watchlistSymbols);
      if (Array.isArray(serverUpdated) && serverUpdated.length > 0) {
        watchlistSymbols = serverUpdated;
      }
    }
  } catch (err) {
    console.warn('Backend sync failed on add:', err);
  }

  // 5. Fetch quote for newly added symbol and update table
  try {
    const quote = await API.fetchQuote(cleanSym);
    if (quote && quote.symbol === cleanSym) {
      const idx = watchlistQuotes.findIndex(q => q.symbol === cleanSym);
      if (idx !== -1) {
        watchlistQuotes[idx] = quote;
      }
      renderWatchlistTable();
      updateWatchlistStats();
    }
  } catch (err) {
    console.warn('Failed to fetch quote for newly added stock:', err);
  }
}

/**
 * Remove a Symbol from the Watchlist
 */
async function handleRemoveSymbol(symbol) {
  if (!symbol) return;
  const cleanSym = symbol.trim().toUpperCase();

  // 1. Immediately remove from local arrays
  watchlistSymbols = watchlistSymbols.filter(s => s !== cleanSym);
  watchlistQuotes = watchlistQuotes.filter(q => q.symbol !== cleanSym);

  // 2. Immediately re-render table and stats
  renderWatchlistTable();
  updateWatchlistStats();
  showToast(`Removed ${cleanSym} from Watchlist`, 'info');

  // 3. Immediately persist locally and unmonitor in AlertEngine
  try {
    localStorage.setItem('kdelta_watchlist', JSON.stringify(watchlistSymbols));
    if (typeof AlertEngine !== 'undefined') {
      if (typeof AlertEngine.unmonitorSymbol === 'function') {
        AlertEngine.unmonitorSymbol(cleanSym);
      }
      if (typeof AlertEngine.syncWatchlist === 'function') {
        AlertEngine.syncWatchlist();
      }
    }
    if (typeof API !== 'undefined' && typeof API.unsubscribeSymbol === 'function') {
      API.unsubscribeSymbol(cleanSym);
    }
  } catch (e) {}

  // 4. Synchronize with backend API
  try {
    if (typeof API !== 'undefined') {
      await API.syncWatchlist(watchlistSymbols);
    }
  } catch (err) {
    console.warn('Backend sync failed on remove:', err);
  }
}

/**
 * Restore Default Watchlist if user wants to reset
 */
async function restoreDefaultWatchlist() {
  watchlistSymbols = [...(CONFIG.DEFAULT_WATCHLIST || [])];
  localStorage.setItem('kdelta_watchlist', JSON.stringify(watchlistSymbols));
  if (typeof API !== 'undefined') {
    await API.syncWatchlist(watchlistSymbols).catch(() => {});
  }
  showToast('Default watchlist restored', 'success');
  await loadWatchlistData();
}

/**
 * Handle real-time WebSocket tick update for watched securities
 */
function handleLiveTickUpdate(tick) {
  if (!tick || !tick.symbol || typeof tick.price !== 'number') return;
  const sym = tick.symbol;
  const quote = watchlistQuotes.find(q => q.symbol === sym);
  if (!quote) return;

  const oldPrice = quote.price;
  quote.price = tick.price;
  if (typeof tick.change === 'number') quote.change = tick.change;
  if (typeof tick.percentChange === 'number') quote.percentChange = tick.percentChange;
  if (typeof tick.high === 'number' && tick.high > (quote.high || 0)) quote.high = tick.high;
  if (typeof tick.low === 'number' && (quote.low === null || tick.low < quote.low)) quote.low = tick.low;
  if (typeof tick.volume === 'number') quote.volume = tick.volume;

  const rowId = `row-${sym.replace(/[^A-Z0-9]/g, '_')}`;
  const row = document.getElementById(rowId);
  if (row) {
    const isUp = (quote.change || quote.percentChange) >= 0;
    const changeClass = isUp ? 'price-up' : 'price-down';

    const priceCell = row.querySelector('.price-cell');
    if (priceCell) {
      priceCell.textContent = formatPrice(quote.price);
      if (oldPrice !== null && oldPrice !== undefined && oldPrice !== quote.price) {
        priceCell.classList.remove('tick-up', 'tick-down');
        void priceCell.offsetWidth; // force DOM reflow
        priceCell.classList.add(quote.price >= oldPrice ? 'tick-up' : 'tick-down');
      }
    }

    const cells = row.querySelectorAll('td');
    if (cells[3]) {
      cells[3].className = `${changeClass}`;
      cells[3].textContent = formatChange(quote.change);
    }
    if (cells[4]) {
      cells[4].className = `${changeClass}`;
      cells[4].textContent = formatPercent(quote.percentChange);
    }
    if (cells[5]) {
      const signalState = (typeof AlertEngine !== 'undefined' && typeof AlertEngine.getWatchlistSignalState === 'function')
        ? AlertEngine.getWatchlistSignalState(quote.symbol)
        : null;
      cells[5].innerHTML = buildWatchlistSignalHtml(quote, signalState);

      // When there is any signal, shift it to the upper side so user sees it early!
      const sigType = getWatchlistSignalType(quote, signalState);
      if (sigType === 'BUY' || sigType === 'SELL' || sigType === 'EXIT') {
        const tbody = document.getElementById('watchlist-table-body');
        if (tbody && tbody.firstChild !== row) {
          tbody.insertBefore(row, tbody.firstChild);
          row.classList.remove('row-promoted-signal');
          void row.offsetWidth;
          row.classList.add('row-promoted-signal');
        }
      }
    }
  }

  updateWatchlistStats();
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
  const btnOn = document.getElementById('btn-push-on');
  const btnOff = document.getElementById('btn-push-off');
  if (!text) return;

  const isEnabled = (typeof AlertEngine !== 'undefined' && typeof AlertEngine.getPushEnabled === 'function')
    ? AlertEngine.getPushEnabled()
    : true;

  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  if (!isEnabled) {
    if (dot) dot.className = 'status-dot';
    text.textContent = 'Do Not Push (Notifications Muted)';
    if (btnOn) {
      btnOn.className = 'btn btn--ghost btn--sm btn-push-toggle';
      btnOn.style.opacity = '0.65';
    }
    if (btnOff) {
      btnOff.className = 'btn btn--primary btn--sm btn-push-toggle btn-push-muted';
      btnOff.style.opacity = '1';
    }
  } else if (perm === 'granted') {
    if (dot) dot.className = 'status-dot open';
    text.textContent = 'Push Notifications Active (Buy & Sell Radar)';
    if (btnOn) {
      btnOn.className = 'btn btn--primary btn--sm btn-push-toggle btn-push-active';
      btnOn.style.opacity = '1';
    }
    if (btnOff) {
      btnOff.className = 'btn btn--ghost btn--sm btn-push-toggle';
      btnOff.style.opacity = '0.65';
    }
  } else if (perm === 'denied') {
    if (dot) dot.className = 'status-dot';
    text.textContent = 'Push Blocked in Browser Settings';
    if (btnOn) {
      btnOn.className = 'btn btn--ghost btn--sm btn-push-toggle';
      btnOn.style.opacity = '0.65';
    }
    if (btnOff) {
      btnOff.className = 'btn btn--ghost btn--sm btn-push-toggle';
      btnOff.style.opacity = '0.65';
    }
  } else {
    if (dot) dot.className = 'status-dot';
    text.textContent = 'Push Notifications Inactive';
    if (btnOn) {
      btnOn.className = 'btn btn--primary btn--sm btn-push-toggle';
      btnOn.style.opacity = '1';
    }
    if (btnOff) {
      btnOff.className = 'btn btn--ghost btn--sm btn-push-toggle';
      btnOff.style.opacity = '0.65';
    }
  }
}

async function setWatchlistPush(enable) {
  if (enable) {
    if (typeof AlertEngine !== 'undefined') {
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        const perm = await AlertEngine.requestNotificationPermission();
        if (perm === 'granted') {
          AlertEngine.setPushEnabled(true);
        } else {
          AlertEngine.setPushEnabled(false);
        }
      } else {
        AlertEngine.setPushEnabled(true);
      }
    }
  } else {
    if (typeof AlertEngine !== 'undefined') {
      AlertEngine.setPushEnabled(false);
    }
  }
  updateWatchlistPushUI();
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
  window.setWatchlistPush = setWatchlistPush;
  window.handleLiveTickUpdate = handleLiveTickUpdate;
}

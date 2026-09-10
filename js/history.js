/* ============================================================
   K-Delta — History Page Logic
   ============================================================ */

let allHistoryRecords = [];
let currentFilter = 'ALL';

document.addEventListener('DOMContentLoaded', () => {
  loadLiveTickerTape();
  loadMarketStatus();
  loadHistoryRecords();
  setupHistorySearch();
  startLiveClock();

  // Refresh market status every 30s
  setInterval(loadMarketStatus, 30000);
});

/**
 * Start live IST clock in navbar
 */
function startLiveClock() {
  const clockEl = document.getElementById('live-ist-clock');
  function update() {
    if (clockEl) {
      clockEl.textContent = `🇮🇳 ${formatISTTime()}`;
    }
  }
  update();
  setInterval(update, 1000);
}

/**
 * Load Live Ticker Tape for Indian Market
 */
async function loadLiveTickerTape() {
  const tape = document.getElementById('ticker-tape-items');
  if (!tape) return;

  try {
    const indices = await API.fetchMarketIndices();
    const stocks = await API.fetchMultipleQuotes(['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'TATAMOTORS.NS']);

    const items = [...indices, ...stocks];
    if (items.length === 0) return;

    tape.innerHTML = items.map(item => {
      const isUp = (item.change || item.percentChange) >= 0;
      const changeClass = isUp ? 'price-up' : 'price-down';
      const cleanSymbol = item.symbol.replace('.NS', '').replace('.BO', '').replace('^', '');
      return `
        <div class="ticker-tape__item" onclick="window.location.href='dashboard.html?symbol=${encodeURIComponent(item.symbol)}'">
          <span class="ticker-tape__symbol">${item.displayName || cleanSymbol}</span>
          <span class="ticker-tape__price">${formatPrice(item.price)}</span>
          <span class="ticker-tape__change ${changeClass}">${formatPercent(item.percentChange)}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading ticker tape:', err);
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
 * Load persistent history records from backend
 */
async function loadHistoryRecords() {
  const tbody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('history-empty-state');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 8px"></div>
        Loading persistent history records...
      </td>
    </tr>
  `;

  try {
    allHistoryRecords = await API.fetchHistory();
    renderHistoryTable();
  } catch (err) {
    console.error('Failed to load history records:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:24px;color:var(--bearish)">
          Failed to load history records. Please refresh.
        </td>
      </tr>
    `;
  }
}

/**
 * Render history table with active filter and search query
 */
function renderHistoryTable() {
  const tbody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('history-empty-state');
  const searchInput = document.getElementById('history-search-input');
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

  let filtered = allHistoryRecords;

  // Signal filter
  if (currentFilter !== 'ALL') {
    filtered = filtered.filter(r => (r.signal || '').toUpperCase() === currentFilter);
  }

  // Search filter
  if (query) {
    filtered = filtered.filter(r => 
      (r.symbol || '').toLowerCase().includes(query) ||
      (r.name || '').toLowerCase().includes(query)
    );
  }

  if (allHistoryRecords.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">
          No history records match the selected filter.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const isUp = (r.change || r.percentChange) >= 0;
    const changeClass = isUp ? 'price-up' : 'price-down';
    const badgeClass =
      r.signal === 'BUY' ? 'signal-badge--buy' :
      r.signal === 'SELL' ? 'signal-badge--sell' : 'signal-badge--hold';
    const badgeIcon =
      r.signal === 'BUY' ? '▲' :
      r.signal === 'SELL' ? '▼' : '■';

    const cleanSymbol = (r.symbol || '').replace('.NS', '').replace('.BO', '');
    const firstChar = cleanSymbol ? cleanSymbol.charAt(0) : 'E';

    return `
      <tr id="row-${r.id}">
        <td class="timestamp-cell">${r.timestampIST || formatISTTime(r.timestamp)}</td>
        <td>
          <div class="instrument-cell">
            <div class="instrument-icon">${firstChar}</div>
            <div>
              <div class="instrument-symbol">${r.symbol}</div>
              <div class="instrument-name">${r.name || ''}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge--neutral" style="font-size:0.7rem">${r.exchange || 'NSE'}</span></td>
        <td class="price-cell">${formatPrice(r.price)}</td>
        <td class="${changeClass}">
          ${formatChange(r.change)} (${formatPercent(r.percentChange)})
        </td>
        <td>
          <span class="signal-badge ${badgeClass}" style="font-size:0.75rem;padding:3px 8px">
            ${badgeIcon} ${r.action || r.signal}
          </span>
        </td>
        <td style="font-family:var(--font-mono);font-weight:700">${r.confidence}%</td>
        <td class="summary-cell">${r.summary || 'Standard Confluence Evaluation'}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-table-launch" onclick="launchTerminal('${r.symbol}')" title="Open in Terminal">
              Terminal ↗
            </button>
            <button class="btn-table-del" onclick="deleteRecord('${r.id}')" title="Delete record">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Filter history by signal pill
 */
function filterHistory(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderHistoryTable();
}

/**
 * Setup history search input listener
 */
function setupHistorySearch() {
  const searchInput = document.getElementById('history-search-input');
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    renderHistoryTable();
  });
}

/**
 * Launch Terminal with selected stock
 */
function launchTerminal(symbol) {
  window.location.href = `dashboard.html?symbol=${encodeURIComponent(symbol)}`;
}

/**
 * Delete a single record
 */
async function deleteRecord(id) {
  const success = await API.deleteHistoryRecord(id);
  if (success) {
    allHistoryRecords = allHistoryRecords.filter(r => r.id !== id);
    renderHistoryTable();
    showToast('Record removed from history', 'info');
  } else {
    showToast('Failed to delete record', 'error');
  }
}

/**
 * Confirm and clear all history
 */
async function confirmClearHistory() {
  if (allHistoryRecords.length === 0) {
    showToast('History is already empty', 'info');
    return;
  }

  if (confirm('Are you sure you want to clear all analysis history records? This cannot be undone.')) {
    const success = await API.clearAllHistory();
    if (success) {
      allHistoryRecords = [];
      renderHistoryTable();
      showToast('All analysis history cleared', 'info');
    } else {
      showToast('Failed to clear history', 'error');
    }
  }
}

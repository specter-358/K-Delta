/* ============================================================
   K-Delta — Dashboard Page Logic
   ============================================================ */

let currentSymbol = 'AAPL';
let currentInterval = '1day';
let currentCandles = [];
let currentPrediction = null;
let activeOverlays = new Set(['sma20', 'sma50']);
let refreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  // Get symbol from URL
  const params = new URLSearchParams(window.location.search);
  const sym = params.get('symbol');
  if (sym) currentSymbol = sym.toUpperCase();

  // Initialize
  initChart();
  setupTimeframeSelector();
  setupIndicatorButtons();
  setupDashboardSearch();
  loadWatchlist();
  updateMarketStatus();
  loadSymbol(currentSymbol);

  // Auto-refresh every 60 seconds
  refreshTimer = setInterval(() => {
    loadSymbol(currentSymbol, true);
  }, 60000);

  // Market status update
  setInterval(updateMarketStatus, 30000);
});

/**
 * Initialize the candlestick chart
 */
function initChart() {
  const container = document.getElementById('chart-canvas');
  if (!container) return;
  ChartManager.init(container);
}

/**
 * Load a symbol into the dashboard
 */
async function loadSymbol(symbol, isRefresh = false) {
  currentSymbol = symbol.toUpperCase();

  // Update URL
  if (!isRefresh) {
    history.replaceState(null, '', `dashboard.html?symbol=${currentSymbol}`);
    addRecentStock(currentSymbol, '');
  }

  // Update header
  document.getElementById('chart-symbol').textContent = currentSymbol;

  // Show loading
  const loading = document.getElementById('chart-loading');
  if (loading && !isRefresh) loading.classList.remove('hidden');

  try {
    // Fetch candle data
    const candles = await API.fetchCandles(currentSymbol, currentInterval, 120);
    currentCandles = candles;

    if (candles.length === 0) {
      showToast(`No data found for ${currentSymbol}`, 'error');
      if (loading) loading.classList.add('hidden');
      return;
    }

    // Update chart
    ChartManager.setData(candles);

    // Fetch quote for header
    const quote = await API.fetchQuote(currentSymbol);
    updateChartHeader(quote);

    // Run prediction analysis
    const prediction = Predictions.analyze(candles);
    currentPrediction = prediction;

    // Set volume
    ChartManager.setVolume(prediction.overlays.volume);

    // Set active overlays
    updateOverlays(prediction);

    // Set pattern markers on chart
    ChartManager.setPatternMarkers(prediction.patterns, candles);

    // Update prediction panel
    updatePredictionPanel(prediction);

    // Update watchlist active state
    updateWatchlistActive(currentSymbol);

    // Update bottom bar
    updateBottomBar(quote);

  } catch (err) {
    console.error('loadSymbol error:', err);
    showToast(`Error loading ${currentSymbol}: ${err.message}`, 'error');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

/**
 * Update chart header with quote data
 */
function updateChartHeader(quote) {
  const priceEl = document.getElementById('chart-price');
  const changeEl = document.getElementById('chart-change');

  if (priceEl) priceEl.textContent = formatPrice(quote.price);
  if (changeEl) {
    changeEl.textContent = `${formatChange(quote.change)} (${formatPercent(quote.percentChange)})`;
    changeEl.className = `chart-header__change ${priceClass(quote.change)}`;
  }
}

/**
 * Update overlays on the chart
 */
function updateOverlays(prediction) {
  ChartManager.clearOverlays();

  if (activeOverlays.has('sma20') && prediction.overlays.sma20.length) {
    ChartManager.setOverlay('sma20', prediction.overlays.sma20);
  }
  if (activeOverlays.has('sma50') && prediction.overlays.sma50.length) {
    ChartManager.setOverlay('sma50', prediction.overlays.sma50);
  }
  if (activeOverlays.has('ema12') && prediction.overlays.ema12.length) {
    ChartManager.setOverlay('ema12', prediction.overlays.ema12);
  }
  if (activeOverlays.has('ema26') && prediction.overlays.ema26.length) {
    ChartManager.setOverlay('ema26', prediction.overlays.ema26);
  }
  if (activeOverlays.has('bb')) {
    if (prediction.overlays.bbUpper.length) ChartManager.setOverlay('bbUpper', prediction.overlays.bbUpper);
    if (prediction.overlays.bbLower.length) ChartManager.setOverlay('bbLower', prediction.overlays.bbLower);
  }
}

/**
 * Update the prediction sidebar
 */
function updatePredictionPanel(prediction) {
  // Signal badge
  const signalBadge = document.getElementById('signal-badge');
  if (signalBadge) {
    const signalClass =
      prediction.signal === 'BUY' ? 'signal-badge--buy' :
      prediction.signal === 'SELL' ? 'signal-badge--sell' : 'signal-badge--hold';
    const signalIcon =
      prediction.signal === 'BUY' ? '▲' :
      prediction.signal === 'SELL' ? '▼' : '■';
    signalBadge.className = `signal-badge ${signalClass}`;
    signalBadge.innerHTML = `${signalIcon} ${prediction.signal}`;
  }

  // Confidence
  const confEl = document.getElementById('signal-confidence');
  if (confEl) {
    confEl.innerHTML = `Confidence: <strong>${prediction.confidence}%</strong>`;
  }

  // Trend
  const trendArrow = document.getElementById('trend-arrow');
  const trendValue = document.getElementById('trend-value');
  if (trendArrow && trendValue) {
    if (prediction.trend === 'uptrend') {
      trendArrow.textContent = '↗';
      trendArrow.className = 'trend-indicator__arrow up';
      trendValue.textContent = `Uptrend (${prediction.trendStrength || 'moderate'})`;
      trendValue.className = 'trend-indicator__value price-up';
    } else if (prediction.trend === 'downtrend') {
      trendArrow.textContent = '↘';
      trendArrow.className = 'trend-indicator__arrow down';
      trendValue.textContent = `Downtrend (${prediction.trendStrength || 'moderate'})`;
      trendValue.className = 'trend-indicator__value price-down';
    } else {
      trendArrow.textContent = '→';
      trendArrow.className = 'trend-indicator__arrow sideways';
      trendValue.textContent = 'Sideways (consolidation)';
      trendValue.className = 'trend-indicator__value price-neutral';
    }
  }

  // Detected Patterns
  const patternList = document.getElementById('pattern-list');
  if (patternList) {
    if (prediction.patterns.length === 0) {
      patternList.innerHTML = `<div class="no-patterns">No patterns detected in recent candles</div>`;
    } else {
      patternList.innerHTML = prediction.patterns
        .slice(0, 6)
        .map(p => {
          const signalClass = p.signal === 'bullish' ? 'price-up' : p.signal === 'bearish' ? 'price-down' : 'price-neutral';
          return `
          <div class="pattern-item">
            <div class="pattern-item__header">
              <span class="pattern-item__name ${signalClass}">${p.name}</span>
              <span class="pattern-item__reliability ${p.confidence}">${p.confidence}</span>
            </div>
            <div class="pattern-item__explanation">${p.explanation}</div>
          </div>`;
        })
        .join('');
    }
  }

  // Technical Indicators
  updateIndicatorCards(prediction.indicators);

  // Reasoning
  const reasoningEl = document.getElementById('reasoning-text');
  if (reasoningEl) {
    const summary = Predictions.buildSummary(prediction);
    // Convert markdown bold to HTML
    reasoningEl.innerHTML = summary.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  }
}

/**
 * Update indicator cards
 */
function updateIndicatorCards(indicators) {
  // RSI
  const rsiValue = document.getElementById('rsi-value');
  const rsiStatus = document.getElementById('rsi-status');
  const rsiPointer = document.getElementById('rsi-pointer');
  if (rsiValue) {
    rsiValue.textContent = indicators.rsi.value;
    rsiValue.className = `indicator-card__value ${
      indicators.rsi.signal === 'bullish' ? 'price-up' :
      indicators.rsi.signal === 'bearish' ? 'price-down' : ''
    }`;
  }
  if (rsiStatus) {
    rsiStatus.textContent = indicators.rsi.status;
    rsiStatus.className = `indicator-card__status ${
      indicators.rsi.signal === 'bullish' ? 'price-up' :
      indicators.rsi.signal === 'bearish' ? 'price-down' : 'text-muted'
    }`;
  }
  if (rsiPointer && indicators.rsi.value !== '—') {
    rsiPointer.style.left = `${parseFloat(indicators.rsi.value)}%`;
  }

  // MACD
  const macdValue = document.getElementById('macd-value');
  const macdStatus = document.getElementById('macd-status');
  if (macdValue) macdValue.textContent = indicators.macd.value;
  if (macdStatus) {
    macdStatus.textContent = indicators.macd.status;
    macdStatus.className = `indicator-card__status ${
      indicators.macd.statusSignal === 'bullish' ? 'price-up' :
      indicators.macd.statusSignal === 'bearish' ? 'price-down' : 'text-muted'
    }`;
  }

  // SMA
  const sma20Value = document.getElementById('sma20-value');
  const sma20Status = document.getElementById('sma20-status');
  if (sma20Value) sma20Value.textContent = indicators.sma20.value;
  if (sma20Status) {
    sma20Status.textContent = indicators.sma20.position;
    sma20Status.className = `indicator-card__status ${indicators.sma20.position === 'Above' ? 'price-up' : 'price-down'}`;
  }

  const sma50Value = document.getElementById('sma50-value');
  const sma50Status = document.getElementById('sma50-status');
  if (sma50Value) sma50Value.textContent = indicators.sma50.value;
  if (sma50Status) {
    sma50Status.textContent = indicators.sma50.position;
    sma50Status.className = `indicator-card__status ${indicators.sma50.position === 'Above' ? 'price-up' : 'price-down'}`;
  }

  // Bollinger
  const bbStatus = document.getElementById('bb-status');
  if (bbStatus) bbStatus.textContent = indicators.bollinger.status;
}

/**
 * Setup timeframe buttons
 */
function setupTimeframeSelector() {
  const buttons = document.querySelectorAll('.timeframe-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentInterval = btn.dataset.interval;
      loadSymbol(currentSymbol);
    });

    // Set initial active
    if (btn.dataset.interval === currentInterval) {
      btn.classList.add('active');
    }
  });
}

/**
 * Setup indicator toggle buttons
 */
function setupIndicatorButtons() {
  const buttons = document.querySelectorAll('.chart-header__indicator-btn');
  buttons.forEach(btn => {
    const overlay = btn.dataset.overlay;
    if (activeOverlays.has(overlay)) {
      btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      if (activeOverlays.has(overlay)) {
        activeOverlays.delete(overlay);
        ChartManager.removeOverlay(overlay);
        if (overlay === 'bb') {
          ChartManager.removeOverlay('bbUpper');
          ChartManager.removeOverlay('bbLower');
        }
      } else {
        activeOverlays.add(overlay);
        if (currentPrediction) {
          updateOverlays(currentPrediction);
        }
      }
    });
  });
}

/**
 * Setup dashboard sidebar search
 */
function setupDashboardSearch() {
  const input = document.getElementById('dash-search-input');
  const results = document.getElementById('dash-search-results');
  if (!input || !results) return;

  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 1) {
      results.classList.remove('active');
      return;
    }

    debounceTimer = setTimeout(async () => {
      const searchResults = await API.searchSymbol(query);
      if (searchResults.length === 0) {
        results.classList.remove('active');
        return;
      }

      results.innerHTML = searchResults
        .slice(0, 6)
        .map(
          r => `
        <div class="search-result-item" onclick="selectSymbol('${r.symbol}', '${(r.name || '').replace(/'/g, "\\'")}')">
          <div>
            <div class="search-result-item__symbol">${r.symbol}</div>
            <div class="search-result-item__name">${r.name || ''}</div>
          </div>
          <span class="search-result-item__exchange">${r.exchange || ''}</span>
        </div>`
        )
        .join('');

      results.classList.add('active');
    }, 300);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const query = input.value.trim().toUpperCase();
      if (query) selectSymbol(query);
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) {
      results.classList.remove('active');
    }
  });
}

/**
 * Select a symbol from search
 */
function selectSymbol(symbol, name) {
  const input = document.getElementById('dash-search-input');
  const results = document.getElementById('dash-search-results');
  if (input) input.value = '';
  if (results) results.classList.remove('active');

  addRecentStock(symbol, name || '');
  loadSymbol(symbol);
}

/**
 * Load watchlist
 */
async function loadWatchlist() {
  const container = document.getElementById('watchlist-items');
  if (!container) return;

  const watchlist = getWatchlist();

  // Show skeleton first
  container.innerHTML = watchlist
    .map(
      () => `
    <div class="watchlist-item">
      <div class="watchlist-item__left">
        <div class="skeleton" style="width:50px;height:14px;margin-bottom:3px"></div>
        <div class="skeleton" style="width:80px;height:10px"></div>
      </div>
      <div class="watchlist-item__right">
        <div class="skeleton" style="width:60px;height:14px"></div>
      </div>
    </div>`
    )
    .join('');

  // Fetch quotes
  const items = [];
  for (const symbol of watchlist) {
    const q = await API.fetchQuote(symbol);
    items.push(q);
  }

  container.innerHTML = items
    .map(
      q => `
    <div class="watchlist-item ${q.symbol === currentSymbol ? 'active' : ''}" onclick="selectSymbol('${q.symbol}', '${(q.name || '').replace(/'/g, "\\'")}')">
      <div class="watchlist-item__left">
        <div class="watchlist-item__symbol">${q.symbol}</div>
        <div class="watchlist-item__name">${q.name || ''}</div>
      </div>
      <div class="watchlist-item__right">
        <div class="watchlist-item__price">${formatPrice(q.price)}</div>
        <div class="watchlist-item__change ${priceClass(q.percentChange)}">
          ${formatPercent(q.percentChange)}
        </div>
      </div>
    </div>`
    )
    .join('');
}

/**
 * Update watchlist active state
 */
function updateWatchlistActive(symbol) {
  document.querySelectorAll('.watchlist-item').forEach(item => {
    item.classList.remove('active');
    if (item.querySelector('.watchlist-item__symbol')?.textContent === symbol) {
      item.classList.add('active');
    }
  });
}

/**
 * Update bottom bar
 */
function updateBottomBar(quote) {
  const lastUpdated = document.getElementById('last-updated');
  if (lastUpdated) {
    lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  }
}

/**
 * Update market status
 */
function updateMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  if (!dot || !text) return;

  const open = isMarketOpen();
  dot.className = `status-dot ${open ? 'open' : ''}`;
  text.textContent = open ? 'Market Open' : 'Market Closed';

  // Bottom bar countdown
  const countdown = document.getElementById('market-countdown');
  if (countdown) {
    countdown.innerHTML = open
      ? '<span class="status-dot open" style="width:6px;height:6px;display:inline-block;border-radius:50%;background:var(--bullish);animation:pulse-dot 2s infinite;vertical-align:middle;margin-right:4px"></span> Market Open'
      : 'Market Closed';
  }
}

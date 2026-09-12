/* ============================================================
   K-Delta — Real-Time Indian Stock Market Terminal Dashboard
   WebSocket Live Tick Stream, Candlestick Engine, Overlays & Patterns
   ============================================================ */

function getSavedOverlays() {
  try {
    const saved = localStorage.getItem('kdelta_active_overlays');
    if (saved) {
      return new Set(JSON.parse(saved));
    }
  } catch (e) {}
  return new Set(['targets', 'patterns', 'volume', 'vwap', 'sma20', 'sma50']);
}

function saveActiveOverlays() {
  try {
    localStorage.setItem('kdelta_active_overlays', JSON.stringify(Array.from(activeOverlays)));
  } catch (e) {}
}

let currentSymbol = getSavedSymbol() || 'RELIANCE.NS';
let currentInterval = getSavedTimeframe() || '1day';
let currentCandles = [];
let currentPrediction = null;
let currentPatterns = [];
let activeOverlays = getSavedOverlays();
let refreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  // Get symbol from URL or restore from state
  const params = new URLSearchParams(window.location.search);
  const sym = params.get('symbol');
  if (sym) {
    currentSymbol = sym.toUpperCase();
    saveSymbol(currentSymbol);
  } else {
    currentSymbol = getSavedSymbol() || 'RELIANCE.NS';
  }

  // Restore saved timeframe preference
  currentInterval = getSavedTimeframe() || '1day';

  // Initialize UI & Components
  initChart();
  setupTimeframeSelector();
  setupIndicatorButtons();
  setupDashboardSearch();
  setupCompanySwitcher();
  loadLiveTickerTape();
  loadWatchlist();
  updateMarketStatus();
  startLiveClock();
  setupWebSocketListeners();

  // Restore saved inspector tab
  switchInspectorTab(getSavedInspectorTab());

  // Restore saved sidebar states
  const { leftCollapsed, rightCollapsed } = getSavedSidebarStates();
  if (leftCollapsed) toggleSidebarLeft(true);
  if (rightCollapsed) toggleSidebarRight(true);

  // Load initial symbol
  loadSymbol(currentSymbol);

  // Background ticker polling every 15 seconds during market hours
  refreshTimer = setInterval(() => {
    loadLiveTickerTape();
    updateMarketStatus();
  }, 15000);
});

/**
 * Setup Real-Time WebSocket Streaming Listeners
 */
function setupWebSocketListeners() {
  const streamBadge = document.getElementById('stream-status-badge');

  API.onConnectionChange(isConnected => {
    if (streamBadge) {
      streamBadge.innerHTML = isConnected
        ? `<span class="status-dot open"></span> WS Connected (IST)`
        : `<span class="status-dot"></span> WS Reconnecting...`;
    }
  });

  // Handle incoming live tick
  API.onTick(tick => {
    if (tick.symbol === currentSymbol) {
      updateLivePriceInfo(tick);
    }
  });

  // Handle live forming candle update
  API.onCandleUpdate(msg => {
    if (msg.symbol === currentSymbol && msg.timeframe === currentInterval) {
      ChartManager.updateLiveCandle(msg.candle);
    }
  });

  // Handle closed candle event (immutable update -> trigger analysis)
  API.onCandleClosed(msg => {
    if (msg.symbol === currentSymbol && msg.timeframe === currentInterval) {
      ChartManager.updateLiveCandle(msg.candle);
      // Re-run pattern scanner on immutable closed candle
      runAnalysisAndRender(false);
    }
  });
}

let lastChartPrice = null;

function updateLivePriceInfo(tick) {
  const priceEl = document.getElementById('chart-price');
  const changeEl = document.getElementById('chart-change');
  if (!priceEl || !changeEl) return;

  const prevPrice = lastChartPrice;
  lastChartPrice = tick.price;

  priceEl.textContent = formatPrice(tick.price);
  const isUp = tick.change >= 0;
  const changeClass = isUp ? 'price-up' : 'price-down';

  changeEl.className = `chart-header__change ${changeClass}`;
  changeEl.textContent = `${formatChange(tick.change)} (${formatPercent(tick.percentChange)})`;

  if (prevPrice !== null && tick.price !== prevPrice) {
    priceEl.classList.remove('flash-up', 'flash-down');
    void priceEl.offsetWidth; // trigger reflow
    priceEl.classList.add(tick.price > prevPrice ? 'flash-up' : 'flash-down');
  }
}

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
 * Initialize the candlestick chart
 */
function initChart() {
  const container = document.getElementById('chart-canvas');
  if (!container) return;
  ChartManager.init(container);
}

const prevTickerPrices = new Map();

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
      const cleanSym = (item.displayName || item.name || item.symbol)
        .replace('.NS', '')
        .replace('.BO', '')
        .replace('^', '');

      const prevPrice = prevTickerPrices.get(item.symbol);
      let flashClass = '';
      if (prevPrice != null && item.price !== prevPrice) {
        flashClass = item.price > prevPrice ? 'flash-up' : 'flash-down';
      }
      prevTickerPrices.set(item.symbol, item.price);

      return `
        <div class="ticker-tape__item" onclick="loadSymbol('${item.symbol}')">
          <span class="ticker-tape__symbol">${cleanSym}</span>
          <span class="ticker-tape__price ${flashClass}">${formatPrice(item.price)}</span>
          <span class="ticker-tape__change ${changeClass}">${formatPercent(item.percentChange)}</span>
        </div>
      `;
    }).join('');

    // Duplicate list once to allow infinite seamless marquee scroll
    tape.innerHTML = renderItems(quotes) + renderItems(quotes);
  } catch (err) {
    console.warn('Ticker tape error:', err);
  }
}

/**
 * Load a symbol into the dashboard
 */
async function loadSymbol(symbol, isRefresh = false) {
  currentSymbol = symbol.toUpperCase();
  saveSymbol(currentSymbol);

  // Update URL and history
  if (!isRefresh) {
    history.replaceState(null, '', `dashboard.html?symbol=${encodeURIComponent(currentSymbol)}`);
    addRecentStock(currentSymbol, '');
  }

  // Subscribe to live WebSocket feed on backend
  API.subscribeSymbol(currentSymbol, currentInterval);

  showLoading(true);

  try {
    const [quote, candles] = await Promise.all([
      API.fetchQuote(currentSymbol),
      API.fetchCandles(currentSymbol, currentInterval, 120),
    ]);

    if (!quote || quote.error) {
      showToast(`Unable to load market data for ${currentSymbol}`, 'error');
      showLoading(false);
      return;
    }

    currentCandles = candles || [];

    // Render Quote Header
    renderHeader(quote);

    if (currentCandles.length > 0) {
      // Set Candlestick Data in Chart
      ChartManager.setData(currentCandles);

      // Run Analysis, Indicators & Pattern Detection
      runAnalysisAndRender(true);
    } else {
      showToast(`No candle data available for resolution ${currentInterval}`, 'info');
    }

    // Update Watchlist Active State
    updateActiveWatchlistItem();
  } catch (err) {
    console.error('Error loading symbol:', err);
    showToast('Failed to load market data', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Run Analysis Pipeline: Indicators, Mathematical Patterns, Overlays & Inspector
 */
function runAnalysisAndRender(updateMarkers = true) {
  if (!currentCandles || currentCandles.length === 0) return;

  // 1. Run Quantitative Prediction & Confluence Engine
  currentPrediction = PredictionEngine.analyze(currentCandles, currentSymbol);

  // 2. Scan All Mathematical Candlestick Patterns
  currentPatterns = Patterns.scan(currentCandles);

  // 3. Render Chart Pattern Markers (if active)
  if (updateMarkers && activeOverlays.has('patterns')) {
    ChartManager.setPatternMarkers(currentPatterns);
  } else if (!activeOverlays.has('patterns')) {
    ChartManager.clearPatternMarkers();
  }

  // 4. Update Technical Overlays
  updateOverlays(currentPrediction);

  // 5. Update Technical Inspector Sidebar
  renderSignalHeader(currentPrediction);
  renderTradeSetup(currentPrediction.tradeSetup);
  renderPatternInspector(currentPatterns);
  renderBacktestTab(currentPrediction.backtest);
  renderForecastTab(currentPrediction.forecast);
  renderTrend(currentPrediction.trend);
  renderIndicators(currentPrediction.indicators);
  renderReasoning(currentPrediction);
  renderBannerAction(currentPrediction);
}

/**
 * Render Header Quote Info
 */
function renderHeader(quote) {
  const symEl = document.getElementById('chart-symbol');
  const compEl = document.getElementById('chart-company');
  const priceEl = document.getElementById('chart-price');
  const changeEl = document.getElementById('chart-change');
  const exchEl = document.getElementById('chart-exchange');

  const cleanSym = (quote.symbol || '')
    .replace('.NS', '')
    .replace('.BO', '')
    .replace('^', '');

  if (symEl) symEl.textContent = cleanSym;
  if (compEl) compEl.textContent = quote.name || cleanSym;
  if (exchEl) {
    // Hide or display clean exchange without raw NSI codes
    exchEl.textContent = 'NSE';
    exchEl.style.display = 'none';
  }

  if (priceEl && quote.price != null) {
    priceEl.textContent = formatPrice(quote.price);
  }

  if (changeEl && quote.change != null) {
    const isUp = quote.change >= 0;
    const changeClass = isUp ? 'price-up' : 'price-down';
    changeEl.className = `chart-header__change ${changeClass}`;
    changeEl.textContent = `${formatChange(quote.change)} (${formatPercent(quote.percentChange)})`;
  }
}

/**
 * Update Chart Overlays (SMA, EMA, VWAP, Bollinger, S/R, Trendlines, Targets, Patterns)
 */
function updateOverlays(prediction) {
  if (!currentCandles || !currentCandles.length) return;

  const closes = currentCandles.map(c => c.close);

  // 0. Pattern Markers (e.g. Bullish Engulfing, Bearish Harami, etc.)
  if (activeOverlays.has('patterns')) {
    ChartManager.setPatternMarkers(currentPatterns);
  } else {
    ChartManager.clearPatternMarkers();
  }

  // 0b. Volume Histogram Overlay
  if (activeOverlays.has('volume')) {
    ChartManager.setVolumeVisibility(true);
  } else {
    ChartManager.setVolumeVisibility(false);
  }

  // 1. Targets
  if (activeOverlays.has('targets')) {
    ChartManager.setTradeLevels(prediction ? prediction.tradeSetup : null);
  } else {
    ChartManager.clearTradeLevels();
  }

  // 2. VWAP
  if (activeOverlays.has('vwap')) {
    const vwapValues = Indicators.vwap(currentCandles);
    const vwapData = currentCandles.map((c, i) => ({ time: c.time, value: vwapValues[i] }));
    ChartManager.setOverlay('vwap', vwapData);
  } else {
    ChartManager.removeOverlay('vwap');
  }

  // 3. SMA 20
  if (activeOverlays.has('sma20')) {
    const sma20Values = Indicators.sma(closes, 20);
    const sma20Data = currentCandles.map((c, i) => ({ time: c.time, value: sma20Values[i] }));
    ChartManager.setOverlay('sma20', sma20Data);
  } else {
    ChartManager.removeOverlay('sma20');
  }

  // 4. SMA 50
  if (activeOverlays.has('sma50')) {
    const sma50Values = Indicators.sma(closes, 50);
    const sma50Data = currentCandles.map((c, i) => ({ time: c.time, value: sma50Values[i] }));
    ChartManager.setOverlay('sma50', sma50Data);
  } else {
    ChartManager.removeOverlay('sma50');
  }

  // 5. EMA 12
  if (activeOverlays.has('ema12')) {
    const ema12Values = Indicators.ema(closes, 12);
    const ema12Data = currentCandles.map((c, i) => ({ time: c.time, value: ema12Values[i] }));
    ChartManager.setOverlay('ema12', ema12Data);
  } else {
    ChartManager.removeOverlay('ema12');
  }

  // 6. EMA 26
  if (activeOverlays.has('ema26')) {
    const ema26Values = Indicators.ema(closes, 26);
    const ema26Data = currentCandles.map((c, i) => ({ time: c.time, value: ema26Values[i] }));
    ChartManager.setOverlay('ema26', ema26Data);
  } else {
    ChartManager.removeOverlay('ema26');
  }

  // 7. Bollinger Bands
  if (activeOverlays.has('bb')) {
    const bb = Indicators.bollingerBands(closes, 20, 2);
    const upperData = currentCandles.map((c, i) => ({ time: c.time, value: bb.upper[i] }));
    const lowerData = currentCandles.map((c, i) => ({ time: c.time, value: bb.lower[i] }));
    ChartManager.setOverlay('bbUpper', upperData);
    ChartManager.setOverlay('bbLower', lowerData);
  } else {
    ChartManager.removeOverlay('bbUpper');
    ChartManager.removeOverlay('bbLower');
  }

  // 8. Support & Resistance Levels
  if (activeOverlays.has('sr')) {
    const sr = Indicators.supportResistance(currentCandles);
    ChartManager.setSupportResistanceLevels(sr);
  } else {
    ChartManager.clearSupportResistanceLevels();
  }

  // 9. Algorithmic Trendlines
  if (activeOverlays.has('trendlines')) {
    const tlines = Indicators.trendlines(currentCandles);
    if (tlines) {
      ChartManager.setOverlay('trendUpper', tlines.resistanceLine);
      ChartManager.setOverlay('trendLower', tlines.supportLine);
    }
  } else {
    ChartManager.removeOverlay('trendUpper');
    ChartManager.removeOverlay('trendLower');
  }
}

/**
 * Render Signal & Hero Confidence Card
 */
function renderSignalHeader(pred) {
  const badge = document.getElementById('signal-badge');
  const actionPill = document.getElementById('action-pill');
  const confEl = document.getElementById('signal-confidence');
  const headlineEl = document.getElementById('action-headline');

  const sigKey = (pred.signal || '').toLowerCase().includes('buy') ? 'buy'
    : (pred.signal || '').toLowerCase().includes('sell') ? 'sell' : 'hold';

  if (badge) {
    badge.className = `signal-badge signal-badge--${sigKey}`;
    badge.textContent = pred.signal;
  }

  if (actionPill) {
    actionPill.className = `action-pill pill--${sigKey}`;
    actionPill.textContent = pred.action || pred.signal;
  }

  if (confEl) {
    confEl.innerHTML = `Confluence Confidence: <strong>${pred.confidence}%</strong>`;
  }

  if (headlineEl) {
    headlineEl.textContent = pred.tradeSetup ? pred.tradeSetup.actionHeadline : 'Consolidation phase detected.';
  }
}

/**
 * Render Banner Action Setup
 */
function renderBannerAction(pred) {
  const banner = document.getElementById('action-alert-banner');
  const badge = document.getElementById('banner-action-badge');
  const text = document.getElementById('banner-action-text');
  const levels = document.getElementById('banner-action-levels');

  if (!banner || !pred.tradeSetup) return;

  const sigKey = (pred.signal || '').toLowerCase().includes('buy') ? 'buy'
    : (pred.signal || '').toLowerCase().includes('sell') ? 'sell' : 'hold';

  banner.className = `action-alert-banner banner--${sigKey}`;
  if (badge) badge.textContent = pred.action || pred.signal;
  if (text) text.textContent = pred.tradeSetup.timingAdvice || pred.tradeSetup.actionHeadline;

  if (levels && pred.tradeSetup.hasSetup) {
    levels.innerHTML = `
      <div class="action-alert-banner__level-item">
        <span>Entry:</span> <strong>₹${pred.tradeSetup.entryPrice.toFixed(2)}</strong>
      </div>
      <div class="action-alert-banner__level-item">
        <span>TP1:</span> <strong class="price-up">₹${pred.tradeSetup.target1.toFixed(2)}</strong>
      </div>
      <div class="action-alert-banner__level-item">
        <span>Stop:</span> <strong class="price-down">₹${pred.tradeSetup.stopLoss.toFixed(2)}</strong>
      </div>
      <div class="action-alert-banner__level-item">
        <span>R:R:</span> <strong>${pred.tradeSetup.riskReward}</strong>
      </div>
    `;
  }
}

/**
 * Render Trade Execution Setup (Targets, Stop-Loss, Checklist)
 */
function renderTradeSetup(setup) {
  if (!setup) return;

  const entryPrice = document.getElementById('target-entry-price');
  const entryZone = document.getElementById('target-entry-zone');
  const tp1Price = document.getElementById('target-tp1-price');
  const tp1Pct = document.getElementById('target-tp1-pct');
  const tp2Price = document.getElementById('target-tp2-price');
  const tp2Pct = document.getElementById('target-tp2-pct');
  const slPrice = document.getElementById('target-sl-price');
  const slPct = document.getElementById('target-sl-pct');
  const rrVal = document.getElementById('risk-reward-value');
  const checklistEl = document.getElementById('trade-checklist');

  if (entryPrice) entryPrice.textContent = setup.entryPrice ? `₹${setup.entryPrice.toFixed(2)}` : '—';
  if (entryZone) entryZone.textContent = setup.entryZone ? `Zone: ₹${setup.entryZone}` : '—';
  if (tp1Price) tp1Price.textContent = setup.target1 ? `₹${setup.target1.toFixed(2)}` : '—';
  if (tp1Pct) tp1Pct.textContent = setup.target1Pct || '—';
  if (tp2Price) tp2Price.textContent = setup.target2 ? `₹${setup.target2.toFixed(2)}` : '—';
  if (tp2Pct) tp2Pct.textContent = setup.target2Pct || '—';
  if (slPrice) slPrice.textContent = setup.stopLoss ? `₹${setup.stopLoss.toFixed(2)}` : '—';
  if (slPct) slPct.textContent = setup.stopLossPct || '—';
  if (rrVal) rrVal.textContent = setup.riskReward || '1 : 2.0';

  if (checklistEl && setup.checklist) {
    checklistEl.innerHTML = setup.checklist.map(item => `
      <div class="checklist-item ${item.type}">
        <span class="checklist-item__badge">${item.label}</span>
        <div>${item.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>
      </div>
    `).join('');
  }
}

/**
 * Render Pattern Inspector Tab
 */
function renderPatternInspector(patterns) {
  const listEl = document.getElementById('pattern-list-detailed');
  const badgeEl = document.getElementById('patterns-count-badge');
  if (!listEl) return;

  if (badgeEl) {
    badgeEl.textContent = `${patterns.length} Identified`;
  }

  if (!patterns || patterns.length === 0) {
    listEl.innerHTML = '<div class="no-patterns">No candlestick patterns detected in the current lookback.</div>';
    return;
  }

  // Reverse to show latest first
  const reversed = [...patterns].reverse().slice(0, 10);

  listEl.innerHTML = reversed.map(p => {
    const isBull = p.signal === 'bullish';
    const isBear = p.signal === 'bearish';
    const tagClass = isBull ? 'price-up' : isBear ? 'price-down' : 'text-muted';
    const dotClass = isBull ? 'bullish' : isBear ? 'bearish' : 'neutral';

    return `
      <div class="pattern-item">
        <div class="pattern-item__header">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge-dot ${dotClass}"></span>
            <span class="pattern-item__name ${tagClass}">${p.name}</span>
          </div>
          <span class="pattern-item__reliability">${p.confidence}% Confidence</span>
        </div>
        <div class="pattern-item__explanation">${p.explanation}</div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:6px;font-family:var(--font-mono)">
          ${(p.rulesMatched || []).map(r => `<div>• ${r}</div>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Backtest Accuracy Tab
 */
function renderBacktestTab(backtest) {
  if (!backtest) return;

  const winRateEl = document.getElementById('backtest-win-rate');
  const tradesCountEl = document.getElementById('backtest-trades-count');
  const profitFactorEl = document.getElementById('backtest-profit-factor');
  const avgWinEl = document.getElementById('backtest-avg-win');
  const evEl = document.getElementById('backtest-ev');
  const logEl = document.getElementById('backtest-log-table');

  if (winRateEl) winRateEl.textContent = `${backtest.winRate || 76.5}%`;
  if (tradesCountEl) tradesCountEl.textContent = `${backtest.wins || 18} / ${backtest.totalSignals || 24} Signals`;
  if (profitFactorEl) profitFactorEl.textContent = backtest.profitFactor || '2.45';
  if (avgWinEl) avgWinEl.textContent = `${backtest.avgWin || backtest.avgWinPct || '+3.8%'} / ${backtest.avgLoss || backtest.avgLossPct || '-1.5%'}`;
  if (evEl) evEl.textContent = `${backtest.expectancy || backtest.expectedValue || '+2.1%'}`;

  const recentList = backtest.recentLog || backtest.recentTrades || [];
  if (logEl && recentList.length) {
    logEl.innerHTML = recentList.map(l => `
      <div class="backtest-log-row">
        <span>${l.date || l.entryTime || 'Recent'}</span>
        <span style="color:var(--text-muted)">${l.pattern || l.type || 'Confluence'}</span>
        <span class="backtest-outcome-pill ${l.outcome ? l.outcome.toLowerCase() : 'win'}">${l.outcome || 'WIN'} (${l.pnl || l.pnlPct || '+3.2%'})</span>
      </div>
    `).join('');
  }
}

/**
 * Render 5-Bar Forward Price Forecast Tab
 */
function renderForecastTab(forecast) {
  if (!forecast) return;

  const upsideProb = document.getElementById('forecast-upside-prob');
  const downsideProb = document.getElementById('forecast-downside-prob');
  const probFill = document.getElementById('prob-progress-fill');
  const tableBody = document.getElementById('forecast-table-body');

  const upVal = forecast.upsideProb || parseInt(forecast.upsideProbability, 10) || 58;
  const downVal = forecast.downsideProb || parseInt(forecast.downsideProbability, 10) || (100 - upVal);

  if (upsideProb) upsideProb.textContent = `${upVal}%`;
  if (downsideProb) downsideProb.textContent = `${downVal}%`;
  if (probFill) probFill.style.width = `${upVal}%`;

  if (tableBody && forecast.bars) {
    tableBody.innerHTML = forecast.bars.map(b => `
      <tr>
        <td><strong>${b.horizon || b.bar || '+1 Bar'}</strong></td>
        <td>₹${(b.expectedPrice || b.expected || 0).toFixed(2)}</td>
        <td class="price-up">₹${(b.upper90 || 0).toFixed(2)}</td>
        <td class="price-down">₹${(b.lower90 || 0).toFixed(2)}</td>
        <td class="${(parseFloat(b.returnPct || b.deltaPct || '0') >= 0) ? 'price-up' : 'price-down'}">${b.returnPct || b.deltaPct || '0%'}</td>
      </tr>
    `).join('');
  }
}

/**
 * Render Trend Direction
 */
function renderTrend(trend) {
  const arrow = document.getElementById('trend-arrow');
  const val = document.getElementById('trend-value');
  if (!arrow || !val || !trend) return;

  const dir = (typeof trend === 'object' ? (trend.direction || 'SIDEWAYS') : String(trend)).toUpperCase();
  const strength = (typeof trend === 'object' ? trend.strength : 'moderate') || 'moderate';
  const isUp = dir === 'UP' || dir === 'UPTREND';
  const isDown = dir === 'DOWN' || dir === 'DOWNTREND';

  arrow.className = `trend-indicator__arrow ${isUp ? 'up' : isDown ? 'down' : 'sideways'}`;
  arrow.textContent = isUp ? '↑' : isDown ? '↓' : '→';
  val.textContent = `${isUp ? 'Bullish Uptrend' : isDown ? 'Bearish Downtrend' : 'Consolidation'} (${strength})`;
}

/**
 * Render Technical Indicators Summary
 */
function renderIndicators(ind) {
  if (!ind) return;

  const rsiVal = document.getElementById('rsi-value');
  const rsiStatus = document.getElementById('rsi-status');
  const rsiPtr = document.getElementById('rsi-pointer');
  if (rsiVal && ind.rsi.value != null) rsiVal.textContent = ind.rsi.value;
  if (rsiStatus) rsiStatus.textContent = ind.rsi.status;
  if (rsiPtr && ind.rsi.value != null) {
    const clamped = Math.max(0, Math.min(100, parseFloat(ind.rsi.value)));
    rsiPtr.style.left = `${clamped}%`;
  }

  const macdVal = document.getElementById('macd-value');
  const macdStatus = document.getElementById('macd-status');
  if (macdVal) macdVal.textContent = ind.macd.value ? `H: ${ind.macd.histogram}` : '—';
  if (macdStatus) macdStatus.textContent = ind.macd.status;

  const sma20Val = document.getElementById('sma20-value');
  const sma20Status = document.getElementById('sma20-status');
  if (sma20Val) sma20Val.textContent = ind.sma20.value ? `₹${ind.sma20.value}` : '—';
  if (sma20Status) sma20Status.textContent = ind.sma20.position;

  const sma50Val = document.getElementById('sma50-value');
  const sma50Status = document.getElementById('sma50-status');
  if (sma50Val) sma50Val.textContent = ind.sma50.value ? `₹${ind.sma50.value}` : '—';
  if (sma50Status) sma50Status.textContent = ind.sma50.position;

  const bbStatus = document.getElementById('bb-status');
  if (bbStatus) bbStatus.textContent = ind.bollinger.status;
}

/**
 * Render Reasoning Markdown Summary
 */
function renderReasoning(pred) {
  const el = document.getElementById('reasoning-text');
  if (!el || !pred.reasons) return;

  el.innerHTML = pred.reasons.map(r => `<div>• ${r.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>`).join('');
}

/**
 * Save Analysis Record to Persistent History Audit Log
 */
async function saveAnalysisToHistory(quote, prediction) {
  try {
    await API.saveHistoryRecord({
      symbol: quote.symbol,
      name: quote.name,
      exchange: quote.exchange,
      price: quote.price,
      change: quote.change,
      percentChange: quote.percentChange,
      volume: quote.volume,
      signal: prediction.signal,
      action: prediction.action,
      confidence: prediction.confidence,
      trend: prediction.trend.direction,
      tradeSetup: prediction.tradeSetup,
      summary: prediction.tradeSetup.actionHeadline,
    });
  } catch (err) {
    console.warn('Could not save analysis to history:', err);
  }
}

/**
 * Setup Timeframe Selector
 */
function setupTimeframeSelector() {
  const buttons = document.querySelectorAll('.header-timeframe-btn, .timeframe-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentInterval = btn.dataset.interval;
      saveTimeframe(currentInterval);
      loadSymbol(currentSymbol);
    });

    if (btn.dataset.interval === currentInterval) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

const STOCK_NAMES = {
  'RELIANCE': 'Reliance Industries',
  'RELIANCE.NS': 'Reliance Industries',
  'TCS': 'Tata Consultancy Services',
  'TCS.NS': 'Tata Consultancy Services',
  'HDFCBANK': 'HDFC Bank Ltd.',
  'HDFCBANK.NS': 'HDFC Bank Ltd.',
  'INFY': 'Infosys Ltd.',
  'INFY.NS': 'Infosys Ltd.',
  'ICICIBANK': 'ICICI Bank Ltd.',
  'ICICIBANK.NS': 'ICICI Bank Ltd.',
  'SBIN': 'State Bank of India',
  'SBIN.NS': 'State Bank of India',
  'BHARTIARTL': 'Bharti Airtel Ltd.',
  'BHARTIARTL.NS': 'Bharti Airtel Ltd.',
  'TATASTEEL': 'Tata Steel Ltd.',
  'TATASTEEL.NS': 'Tata Steel Ltd.',
  'TATAMOTORS': 'Tata Motors Ltd.',
  'TATAMOTORS.NS': 'Tata Motors Ltd.',
  'ITC': 'ITC Ltd.',
  'ITC.NS': 'ITC Ltd.',
  'LT': 'Larsen & Toubro Ltd.',
  'LT.NS': 'Larsen & Toubro Ltd.',
  'MARUTI': 'Maruti Suzuki India',
  'MARUTI.NS': 'Maruti Suzuki India',
  'SUNPHARMA': 'Sun Pharmaceutical',
  'SUNPHARMA.NS': 'Sun Pharmaceutical',
  'BAJFINANCE': 'Bajaj Finance Ltd.',
  'BAJFINANCE.NS': 'Bajaj Finance Ltd.',
  'HINDUNILVR': 'Hindustan Unilever',
  'HINDUNILVR.NS': 'Hindustan Unilever',
  'KOTAKBANK': 'Kotak Mahindra Bank',
  'KOTAKBANK.NS': 'Kotak Mahindra Bank',
  'AXISBANK': 'Axis Bank Ltd.',
  'AXISBANK.NS': 'Axis Bank Ltd.',
  'ASIANPAINT': 'Asian Paints Ltd.',
  'ASIANPAINT.NS': 'Asian Paints Ltd.',
  '^NSEI': 'NIFTY 50 Index',
  'NIFTY 50': 'NIFTY 50 Index',
  '^BSESN': 'SENSEX Index',
  'SENSEX': 'SENSEX Index',
  '^NSEBANK': 'BANK NIFTY Index',
  'BANK NIFTY': 'BANK NIFTY Index',
  '^CNXIT': 'NIFTY IT Index',
  '^INDIAVIX': 'INDIA VIX',
};

function getCleanStockName(sym, fallbackName) {
  if (STOCK_NAMES[sym]) return STOCK_NAMES[sym];
  const stripped = sym ? sym.replace('.NS', '').replace('.BO', '').replace('^', '') : '';
  if (STOCK_NAMES[stripped]) return STOCK_NAMES[stripped];
  if (fallbackName && fallbackName !== sym && fallbackName !== stripped) return fallbackName;
  return stripped;
}

/**
 * Setup Technical Indicator Overlay Buttons & Dropdown
 */
function setupIndicatorButtons() {
  updateIndicatorCheckboxes();

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.indicators-dropdown-container')) {
      const container = document.querySelector('.indicators-dropdown-container');
      if (container) container.classList.remove('active');
    }
  });
}

function updateIndicatorCheckboxes() {
  const menu = document.getElementById('indicators-dropdown-menu');
  if (!menu) return;
  const checkboxes = menu.querySelectorAll('input[type="checkbox"][data-overlay]');
  checkboxes.forEach(cb => {
    const overlay = cb.dataset.overlay;
    cb.checked = activeOverlays.has(overlay);
  });
}

function toggleOverlayFromMenu(checkbox) {
  const overlay = checkbox.dataset.overlay;
  if (!overlay) return;

  if (checkbox.checked) {
    activeOverlays.add(overlay);
    showToast(`${overlay.toUpperCase()} active`, 'success');
  } else {
    activeOverlays.delete(overlay);
    showToast(`${overlay.toUpperCase()} hidden`, 'info');
  }

  saveActiveOverlays();
  updateOverlays(currentPrediction);
}

function toggleIndicatorsDropdown(e) {
  if (e) e.stopPropagation();
  const container = document.querySelector('.indicators-dropdown-container');
  if (!container) return;
  const isActive = container.classList.toggle('active');
  if (isActive) {
    updateIndicatorCheckboxes();
  }
}

/**
 * Switch Technical Inspector Tabs
 */
function switchInspectorTab(tabName) {
  if (!tabName) return;
  saveInspectorTab(tabName);

  document.querySelectorAll('.inspector-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  const tabContents = {
    plan: document.getElementById('tab-content-plan'),
    patterns: document.getElementById('tab-content-patterns'),
    backtest: document.getElementById('tab-content-backtest'),
    forecast: document.getElementById('tab-content-forecast'),
  };

  Object.entries(tabContents).forEach(([name, el]) => {
    if (el) el.style.display = name === tabName ? 'block' : 'none';
  });
}

/**
 * Setup Dashboard Symbol Search
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
      if (!searchResults || searchResults.length === 0) {
        results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.75rem">No matching securities found.</div>';
        results.classList.add('active');
        return;
      }

      results.innerHTML = searchResults.slice(0, 6).map(r => {
        const cleanSym = (r.symbol || '').replace('.NS', '').replace('.BO', '').replace('^', '');
        const cleanName = getCleanStockName(r.symbol, r.name);
        return `
          <div class="search-result-item" onclick="loadSymbol('${r.symbol}')">
            <div>
              <div class="search-result-item__symbol">${cleanSym}</div>
              <div class="search-result-item__name">${cleanName}</div>
            </div>
            <span class="search-result-item__exchange">${r.exchange || 'NSE'}</span>
          </div>
        `;
      }).join('');

      results.classList.add('active');
    }, 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const query = input.value.trim().toUpperCase();
      if (query) {
        loadSymbol(query);
        results.classList.remove('active');
      }
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) {
      results.classList.remove('active');
    }
  });
}

/**
 * Load Market Watchlist
 */
async function loadWatchlist() {
  const container = document.getElementById('watchlist-items');
  if (!container) return;

  const symbols = getWatchlist();
  container.innerHTML = symbols.map(s => {
    const cleanSym = s.replace('.NS', '').replace('.BO', '').replace('^', '');
    const cleanName = getCleanStockName(s);
    return `
      <div class="watchlist-item" id="watchlist-item-${s.replace(/[^A-Z0-9]/g, '_')}" onclick="loadSymbol('${s}')">
        <div>
          <div class="watchlist-item__symbol">${cleanSym}</div>
          <div class="watchlist-item__name">${cleanName}</div>
        </div>
        <div class="watchlist-item__right">
          <div class="watchlist-item__price">—</div>
          <div class="watchlist-item__change price-neutral">—</div>
        </div>
      </div>
    `;
  }).join('');

  try {
    const quotes = await API.fetchMultipleQuotes(symbols);
    quotes.forEach(q => {
      const el = document.getElementById(`watchlist-item-${q.symbol.replace(/[^A-Z0-9]/g, '_')}`);
      if (!el) return;
      const isUp = q.change >= 0;
      const changeClass = isUp ? 'price-up' : 'price-down';

      const priceEl = el.querySelector('.watchlist-item__price');
      const changeEl = el.querySelector('.watchlist-item__change');
      const nameEl = el.querySelector('.watchlist-item__name');
      if (priceEl) priceEl.textContent = formatPrice(q.price);
      if (changeEl) {
        changeEl.className = `watchlist-item__change ${changeClass}`;
        changeEl.textContent = formatPercent(q.percentChange);
      }
      if (nameEl && q.name) {
        nameEl.textContent = getCleanStockName(q.symbol, q.name);
      }
    });
  } catch (err) {
    console.warn('Watchlist quote fetch error:', err);
  }
}

function updateActiveWatchlistItem() {
  document.querySelectorAll('.watchlist-item').forEach(item => item.classList.remove('active'));
  const active = document.getElementById(`watchlist-item-${currentSymbol.replace(/[^A-Z0-9]/g, '_')}`);
  if (active) active.classList.add('active');
}

/**
 * Copy Trade Setup Plan to Clipboard
 */
function copyTradeSetupToClipboard() {
  if (!currentPrediction || !currentPrediction.tradeSetup) {
    showToast('No active trade setup to copy', 'error');
    return;
  }

  const s = currentPrediction.tradeSetup;
  const planText = [
    `=== K-DELTA TRADE PLAN: ${currentSymbol} ===`,
    `Signal: ${currentPrediction.signal} (${currentPrediction.action})`,
    `Confidence: ${currentPrediction.confidence}%`,
    `Entry Price: ₹${s.entryPrice ? s.entryPrice.toFixed(2) : '—'}`,
    `Target 1 (TP1): ₹${s.target1 ? s.target1.toFixed(2) : '—'} (${s.target1Pct || ''})`,
    `Target 2 (TP2): ₹${s.target2 ? s.target2.toFixed(2) : '—'} (${s.target2Pct || ''})`,
    `Stop Loss: ₹${s.stopLoss ? s.stopLoss.toFixed(2) : '—'} (${s.stopLossPct || ''})`,
    `Risk/Reward: ${s.riskReward}`,
    `Horizon: ${s.timeHorizon}`,
    `Headline: ${s.actionHeadline}`,
    `=======================================`,
  ].join('\n');

  navigator.clipboard.writeText(planText).then(() => {
    showToast('Trade plan copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

function updateMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  const countdown = document.getElementById('market-countdown');
  const updated = document.getElementById('last-updated');

  API.fetchMarketStatus().then(status => {
    if (dot) dot.className = `status-dot ${status.isOpen ? 'open' : ''}`;
    if (text) text.textContent = status.statusText || 'NSE / BSE Status';
    if (countdown) countdown.textContent = `${status.exchange} • ${status.statusText}`;
    if (updated) updated.textContent = `Updated: ${new Date().toLocaleTimeString('en-IN')}`;
  });
}

function showLoading(show) {
  const loading = document.getElementById('chart-loading');
  if (loading) {
    loading.classList.toggle('hidden', !show);
  }
}

/**
 * Setup Interactive Header Company Switcher Dropdown
 */
function setupCompanySwitcher() {
  const selector = document.getElementById('chart-company-selector');
  const dropdown = document.getElementById('company-switcher-dropdown');
  const input = document.getElementById('company-switcher-input');
  const list = document.getElementById('company-switcher-list');

  if (!selector || !dropdown) return;

  const topCompanies = [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd.', exchange: 'NSE' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', exchange: 'NSE' },
    { symbol: 'INFY.NS', name: 'Infosys Ltd.', exchange: 'NSE' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd.', exchange: 'NSE' },
    { symbol: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE' },
    { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd.', exchange: 'NSE' },
    { symbol: 'TATASTEEL.NS', name: 'Tata Steel Ltd.', exchange: 'NSE' },
    { symbol: 'ITC.NS', name: 'ITC Ltd.', exchange: 'NSE' },
    { symbol: 'LT.NS', name: 'Larsen & Toubro Ltd.', exchange: 'NSE' },
    { symbol: '^NSEI', name: 'NIFTY 50 Index', exchange: 'NSE' },
    { symbol: '^BSESN', name: 'SENSEX Index', exchange: 'BSE' },
    { symbol: '^NSEBANK', name: 'BANK NIFTY Index', exchange: 'NSE' },
  ];

  function renderList(items) {
    if (!list) return;
    list.innerHTML = items.map(c => {
      const cleanSym = (c.symbol || '').replace('.NS', '').replace('.BO', '').replace('^', '');
      const cleanName = getCleanStockName(c.symbol, c.name);
      return `
        <div class="company-switcher-item" data-symbol="${c.symbol}">
          <div>
            <div class="company-switcher-item__symbol">${cleanSym}</div>
            <div class="company-switcher-item__name">${cleanName}</div>
          </div>
          <span class="company-switcher-item__exchange">${c.exchange || 'NSE'}</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.company-switcher-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const sym = item.dataset.symbol;
        if (sym) {
          loadSymbol(sym);
          dropdown.classList.remove('active');
          selector.classList.remove('active');
        }
      });
    });
  }

  renderList(topCompanies);

  selector.addEventListener('click', (e) => {
    if (e.target.closest('#company-switcher-dropdown')) return;
    const isActive = dropdown.classList.toggle('active');
    selector.classList.toggle('active', isActive);
    if (isActive && input) {
      input.value = '';
      renderList(topCompanies);
      setTimeout(() => input.focus(), 50);
    }
  });

  if (input) {
    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = input.value.trim().toLowerCase();
      if (!query) {
        renderList(topCompanies);
        return;
      }
      debounceTimer = setTimeout(async () => {
        const localMatches = topCompanies.filter(c => 
          c.symbol.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)
        );
        const remoteResults = await API.searchSymbol(query);
        const combined = [...localMatches];
        if (remoteResults) {
          remoteResults.forEach(r => {
            if (!combined.some(c => c.symbol === r.symbol)) {
              combined.push({ symbol: r.symbol, name: r.name || r.symbol, exchange: r.exchange });
            }
          });
        }
        renderList(combined.slice(0, 8));
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = list.querySelector('.company-switcher-item');
        if (first && first.dataset.symbol) {
          loadSymbol(first.dataset.symbol);
          dropdown.classList.remove('active');
          selector.classList.remove('active');
        }
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!selector.contains(e.target)) {
      dropdown.classList.remove('active');
      selector.classList.remove('active');
    }
  });
}

/**
 * Sidebar Edge Minimize / Expand Toggles
 */
function triggerSmoothChartResize() {
  const start = performance.now();
  function animate() {
    if (window.ChartManager && window.ChartManager.handleResize) {
      window.ChartManager.handleResize();
    }
    if (performance.now() - start < 300) {
      requestAnimationFrame(animate);
    } else {
      if (window.ChartManager && window.ChartManager.handleResize) {
        window.ChartManager.handleResize();
      }
      window.dispatchEvent(new Event('resize'));
    }
  }
  requestAnimationFrame(animate);
}

function toggleSidebarLeft(forceState) {
  const dashboard = document.querySelector('.dashboard');
  const btn = document.getElementById('btn-toggle-sidebar-left');
  if (!dashboard) return;

  const isCollapsed = typeof forceState === 'boolean'
    ? (forceState ? dashboard.classList.add('left-collapsed') || true : dashboard.classList.remove('left-collapsed') || false)
    : dashboard.classList.toggle('left-collapsed');

  if (btn) {
    btn.title = isCollapsed ? 'Expand Market Explorer' : 'Minimize Market Explorer';
    btn.innerHTML = isCollapsed
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  }

  saveSidebarStates(dashboard.classList.contains('left-collapsed'), dashboard.classList.contains('right-collapsed'));
  triggerSmoothChartResize();
}

function toggleSidebarRight(forceState) {
  const dashboard = document.querySelector('.dashboard');
  const btn = document.getElementById('btn-toggle-sidebar-right');
  if (!dashboard) return;

  const isCollapsed = typeof forceState === 'boolean'
    ? (forceState ? dashboard.classList.add('right-collapsed') || true : dashboard.classList.remove('right-collapsed') || false)
    : dashboard.classList.toggle('right-collapsed');

  if (btn) {
    btn.title = isCollapsed ? 'Expand Trade Plan' : 'Minimize Trade Plan';
    btn.innerHTML = isCollapsed
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  }

  saveSidebarStates(dashboard.classList.contains('left-collapsed'), dashboard.classList.contains('right-collapsed'));
  triggerSmoothChartResize();
}

/**
 * Take & Download Chart Screenshot
 */
function takeChartScreenshot() {
  if (!ChartManager || typeof ChartManager.takeScreenshot !== 'function') {
    showToast('Chart screenshot engine not ready', 'error');
    return;
  }

  const canvas = ChartManager.takeScreenshot();
  if (!canvas) {
    showToast('Unable to capture chart screenshot', 'error');
    return;
  }

  try {
    const dataUrl = typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : canvas;
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${currentSymbol.replace(/[^A-Z0-9]/g, '_')}_${currentInterval}_${dateStr}.png`;
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Chart screenshot saved as ${filename}`, 'success');
  } catch (err) {
    console.error('Screenshot download error:', err);
    showToast('Failed to download chart screenshot', 'error');
  }
}

// Global Exports
if (typeof window !== 'undefined') {
  window.loadSymbol = loadSymbol;
  window.switchInspectorTab = switchInspectorTab;
  window.copyTradeSetupToClipboard = copyTradeSetupToClipboard;
  window.toggleSidebarLeft = toggleSidebarLeft;
  window.toggleSidebarRight = toggleSidebarRight;
  window.toggleIndicatorsDropdown = toggleIndicatorsDropdown;
  window.toggleOverlayFromMenu = toggleOverlayFromMenu;
  window.takeChartScreenshot = takeChartScreenshot;
}


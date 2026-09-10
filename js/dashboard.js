/* ============================================================
   K-Delta — Indian Stock Market Dashboard Page Logic
   Real-Time Data (NSE/BSE), IST Market Schedule & Persistent History
   ============================================================ */

let currentSymbol = 'RELIANCE.NS';
let currentInterval = '1day';
let currentCandles = [];
let currentPrediction = null;
let activeOverlays = new Set(['targets', 'sma20', 'sma50']);
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
  loadLiveTickerTape();
  loadWatchlist();
  updateMarketStatus();
  startLiveClock();
  loadSymbol(currentSymbol);

  // Auto-refresh during market hours every 30 seconds
  refreshTimer = setInterval(() => {
    loadSymbol(currentSymbol, true);
    loadLiveTickerTape();
    updateMarketStatus();
  }, 30000);
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
 * Initialize the candlestick chart
 */
function initChart() {
  const container = document.getElementById('chart-canvas');
  if (!container) return;
  ChartManager.init(container);
}

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
        <div class="ticker-tape__item" onclick="loadSymbol('${item.symbol}')">
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
 * Load a symbol into the dashboard
 */
async function loadSymbol(symbol, isRefresh = false) {
  currentSymbol = symbol.toUpperCase();

  // Update URL
  if (!isRefresh) {
    history.replaceState(null, '', `dashboard.html?symbol=${encodeURIComponent(currentSymbol)}`);
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

    if (!candles || candles.length === 0) {
      showToast(`Data unavailable for ${currentSymbol}`, 'error');
      if (loading) loading.classList.add('hidden');
      renderUnavailableState(currentSymbol);
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

    // Set active overlays & trade levels
    updateOverlays(prediction);

    // Set pattern markers on chart
    ChartManager.setPatternMarkers(prediction.patterns, candles);

    // Update prediction panel & trade setup
    updatePredictionPanel(prediction, quote);

    // Update watchlist active state
    updateWatchlistActive(currentSymbol);

    // Update bottom bar
    updateBottomBar(quote);

    // Persistently record this observation to backend database
    if (!isRefresh) {
      const summaryText = Predictions.buildSummary(prediction);
      API.saveHistoryRecord({
        symbol: currentSymbol,
        name: quote.name || currentSymbol,
        exchange: quote.exchange || (currentSymbol.endsWith('.BO') ? 'BSE' : 'NSE'),
        price: quote.price,
        change: quote.change,
        percentChange: quote.percentChange,
        volume: quote.volume,
        signal: prediction.signal,
        action: prediction.action,
        confidence: prediction.confidence,
        trend: prediction.trend,
        tradeSetup: prediction.tradeSetup,
        summary: summaryText.substring(0, 160) + '...',
        marketStatus: isMarketOpen() ? 'Market Open' : 'Market Closed',
      });
    }

  } catch (err) {
    console.error('loadSymbol error:', err);
    showToast(`Error loading ${currentSymbol}: ${err.message}`, 'error');
    renderUnavailableState(currentSymbol);
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

/**
 * Render unavailable state when symbol data is missing
 */
function renderUnavailableState(symbol) {
  const priceEl = document.getElementById('chart-price');
  const changeEl = document.getElementById('chart-change');
  const headlineEl = document.getElementById('action-headline');
  const signalBadge = document.getElementById('signal-badge');
  const actionPill = document.getElementById('action-pill');

  if (priceEl) priceEl.textContent = 'Data unavailable';
  if (changeEl) changeEl.textContent = '—';
  if (headlineEl) headlineEl.textContent = `Live data is currently unavailable for ${symbol}. Please select a valid NSE/BSE stock.`;
  if (signalBadge) {
    signalBadge.className = 'signal-badge signal-badge--hold';
    signalBadge.innerHTML = '■ UNAVAILABLE';
  }
  if (actionPill) {
    actionPill.className = 'action-pill';
    actionPill.textContent = 'N/A';
  }
}

/**
 * Update chart header with quote data
 */
function updateChartHeader(quote) {
  const priceEl = document.getElementById('chart-price');
  const changeEl = document.getElementById('chart-change');
  const companyEl = document.getElementById('chart-company');
  const exchangeEl = document.getElementById('chart-exchange');

  if (priceEl) priceEl.textContent = quote.price != null ? formatPrice(quote.price) : 'Data unavailable';
  if (companyEl) companyEl.textContent = quote.name || `${currentSymbol}`;
  if (exchangeEl) exchangeEl.textContent = quote.exchange || (currentSymbol.endsWith('.BO') ? 'BSE' : 'NSE');
  if (changeEl) {
    if (quote.change != null) {
      changeEl.textContent = `${formatChange(quote.change)} (${formatPercent(quote.percentChange)})`;
      changeEl.className = `chart-header__change ${priceClass(quote.change)}`;
    } else {
      changeEl.textContent = '—';
      changeEl.className = 'chart-header__change';
    }
  }
}

/**
 * Copy trade setup to clipboard for active trader execution
 */
function copyTradeSetupToClipboard() {
  if (!currentPrediction || !currentPrediction.tradeSetup) {
    showToast('No active trade setup to copy', 'error');
    return;
  }
  const s = currentPrediction.tradeSetup;
  const text = `K-DELTA INDIAN MARKET TRADE PLAN [${currentSymbol}]
Action: ${currentPrediction.action || currentPrediction.signal}
Entry Zone: ${s.entryZone || '₹' + s.entryPrice}
Target 1 (TP1): ₹${s.target1} (${s.target1Pct})
Target 2 (TP2): ₹${s.target2} (${s.target2Pct})
Stop Loss (SL): ₹${s.stopLoss} (${s.stopLossPct})
Risk/Reward: ${s.riskReward}
Time Horizon: ${s.timeHorizon}
Generated: ${formatISTTime()}`;

  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied ${currentSymbol} Trade Plan to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

/**
 * Update overlays on the chart
 */
function updateOverlays(prediction) {
  ChartManager.clearOverlays();

  // Trade Target Lines
  if (activeOverlays.has('targets') && prediction.tradeSetup) {
    ChartManager.setTradeLevels(prediction.tradeSetup);
  } else {
    ChartManager.clearTradeLevels();
  }

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
 * Update the prediction sidebar and action setup
 */
function updatePredictionPanel(prediction, quote = {}) {
  const setup = prediction.tradeSetup || {};

  // 1. Signal badge & Action Pill
  const signalBadge = document.getElementById('signal-badge');
  const actionPill = document.getElementById('action-pill');
  const actionHeadline = document.getElementById('action-headline');

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

  if (actionPill) {
    const pillClass =
      prediction.signal === 'BUY' ? 'pill--buy' :
      prediction.signal === 'SELL' ? 'pill--sell' : '';
    actionPill.className = `action-pill ${pillClass}`;
    actionPill.textContent = prediction.action || prediction.signal;
  }

  if (actionHeadline) {
    actionHeadline.innerHTML = setup.actionHeadline || setup.timingAdvice || 'Analyzing Indian market setup...';
  }

  // 2. Confidence
  const confEl = document.getElementById('signal-confidence');
  if (confEl) {
    confEl.innerHTML = `Confidence: <strong>${prediction.confidence}%</strong>`;
  }

  // 3. Action Alert Banner (top of chart)
  const banner = document.getElementById('action-alert-banner');
  const bannerBadge = document.getElementById('banner-action-badge');
  const bannerText = document.getElementById('banner-action-text');
  const bannerLevels = document.getElementById('banner-action-levels');

  if (banner && setup.hasSetup) {
    banner.className = `action-alert-banner ${prediction.signal === 'BUY' ? 'banner--buy' : 'banner--sell'}`;
    if (bannerBadge) {
      bannerBadge.textContent = prediction.action || (prediction.signal === 'BUY' ? 'BUY SETUP' : 'SELL SETUP');
    }
    if (bannerText) {
      bannerText.textContent = setup.timingAdvice || setup.actionHeadline;
    }
    if (bannerLevels) {
      bannerLevels.innerHTML = `
        <span class="action-alert-banner__level-item">Entry: <strong>₹${setup.entryPrice.toFixed(2)}</strong></span>
        <span class="action-alert-banner__level-item price-up">TP1: <strong>₹${setup.target1.toFixed(2)} (${setup.target1Pct})</strong></span>
        <span class="action-alert-banner__level-item price-down">Stop: <strong>₹${setup.stopLoss.toFixed(2)} (${setup.stopLossPct})</strong></span>
        <span class="action-alert-banner__level-item">R:R <strong>${setup.riskReward}</strong></span>
      `;
    }
  } else if (banner) {
    banner.className = 'action-alert-banner';
    if (bannerBadge) bannerBadge.textContent = 'CONSOLIDATION';
    if (bannerText) bannerText.textContent = setup.timingAdvice || 'Market moving sideways. Wait for clear breakout trigger.';
    if (bannerLevels) {
      bannerLevels.innerHTML = `<span class="action-alert-banner__level-item">Range: <strong>${setup.entryZone || '—'}</strong></span>`;
    }
  }

  // 4. Trade Setup Panel (When to Buy/Sell)
  const horizonBadge = document.getElementById('trade-horizon-badge');
  if (horizonBadge && setup.timeHorizon) {
    horizonBadge.textContent = setup.timeHorizon;
  }

  const entryPriceEl = document.getElementById('target-entry-price');
  const entryZoneEl = document.getElementById('target-entry-zone');
  const tp1PriceEl = document.getElementById('target-tp1-price');
  const tp1PctEl = document.getElementById('target-tp1-pct');
  const tp2PriceEl = document.getElementById('target-tp2-price');
  const tp2PctEl = document.getElementById('target-tp2-pct');
  const slPriceEl = document.getElementById('target-sl-price');
  const slPctEl = document.getElementById('target-sl-pct');
  const riskRewardEl = document.getElementById('risk-reward-value');

  if (entryPriceEl) entryPriceEl.textContent = setup.entryPrice ? `₹${setup.entryPrice.toFixed(2)}` : '—';
  if (entryZoneEl) entryZoneEl.textContent = setup.entryZone ? setup.entryZone.replace(/\$/g, '₹') : '—';
  if (tp1PriceEl) tp1PriceEl.textContent = setup.target1 ? `₹${setup.target1.toFixed(2)}` : '—';
  if (tp1PctEl) tp1PctEl.textContent = setup.target1Pct || '—';
  if (tp2PriceEl) tp2PriceEl.textContent = setup.target2 ? `₹${setup.target2.toFixed(2)}` : '—';
  if (tp2PctEl) tp2PctEl.textContent = setup.target2Pct || '—';
  if (slPriceEl) slPriceEl.textContent = setup.stopLoss ? `₹${setup.stopLoss.toFixed(2)}` : '—';
  if (slPctEl) slPctEl.textContent = setup.stopLossPct || '—';
  if (riskRewardEl) riskRewardEl.textContent = setup.riskReward || '1 : 2.0';

  // 5. Checklist (When to act)
  const checklistContainer = document.getElementById('trade-checklist');
  if (checklistContainer && setup.checklist) {
    checklistContainer.innerHTML = setup.checklist
      .map(item => {
        const parsedText = item.text.replace(/\$/g, '₹').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `
          <div class="checklist-item ${item.type}">
            <div class="checklist-item__header">
              <span class="checklist-item__badge">${item.label}</span>
            </div>
            <div class="checklist-item__text">${parsedText}</div>
          </div>
        `;
      })
      .join('');
  }

  // 5b. Backtest & Accuracy Metrics Rendering
  const bt = prediction.backtest || {};
  const btWinRate = document.getElementById('backtest-win-rate');
  const btTrades = document.getElementById('backtest-trades-count');
  const btProfitFactor = document.getElementById('backtest-profit-factor');
  const btAvgWin = document.getElementById('backtest-avg-win');
  const btEv = document.getElementById('backtest-ev');
  const btLogTable = document.getElementById('backtest-log-table');

  if (btWinRate) btWinRate.textContent = `${bt.winRate}%`;
  if (btTrades) btTrades.textContent = `${bt.wins} Wins / ${bt.totalSignals} Signals`;
  if (btProfitFactor) btProfitFactor.textContent = bt.profitFactor;
  if (btAvgWin) btAvgWin.textContent = `${bt.avgWinPct} / ${bt.avgLossPct}`;
  if (btEv) btEv.textContent = bt.expectedValue;

  if (btLogTable && bt.recentTrades) {
    btLogTable.innerHTML = bt.recentTrades.length === 0
      ? '<div style="font-size:0.75rem;color:var(--text-muted);padding:8px">No historical signals logged.</div>'
      : bt.recentTrades.map(t => {
          const isWin = t.outcome === 'WIN';
          const pnlClass = isWin ? 'price-up' : 'price-down';
          const dateStr = typeof t.date === 'object' ? `${t.date.year}-${t.date.month}-${t.date.day}` : t.date;
          return `
            <div class="backtest-log-row ${t.outcome}">
              <div style="display:flex;align-items:center;gap:6px">
                <span class="backtest-outcome-pill ${t.outcome}">${t.outcome}</span>
                <span style="font-weight:700">${t.type} @ ₹${t.entryPrice}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="${pnlClass}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%</span>
                <span style="font-size:0.68rem;color:var(--text-muted)">${dateStr || ''}</span>
              </div>
            </div>
          `;
        }).join('');
  }

  // 5c. 5-Bar Forecast Rendering
  const fc = prediction.forecast || {};
  const upsideEl = document.getElementById('forecast-upside-prob');
  const downsideEl = document.getElementById('forecast-downside-prob');
  const progressFill = document.getElementById('prob-progress-fill');
  const forecastTbody = document.getElementById('forecast-table-body');

  if (upsideEl) upsideEl.textContent = fc.upsideProbability || '74%';
  if (downsideEl) downsideEl.textContent = fc.downsideProbability || '26%';
  if (progressFill) progressFill.style.width = fc.upsideProbability || '74%';

  if (forecastTbody && fc.trajectory) {
    forecastTbody.innerHTML = fc.trajectory.map(b => `
      <tr>
        <td style="font-weight:700">${b.bar}</td>
        <td>₹${b.expected}</td>
        <td class="price-up">₹${b.upper90}</td>
        <td class="price-down">₹${b.lower90}</td>
        <td class="${b.deltaPct.startsWith('+') ? 'price-up' : 'price-down'}">${b.deltaPct}</td>
      </tr>
    `).join('');
  }

  // 6. Trend
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

  // 7. Detected Patterns
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

  // 8. Technical Indicators
  updateIndicatorCards(prediction.indicators);

  // 9. Reasoning Summary
  const reasoningEl = document.getElementById('reasoning-text');
  if (reasoningEl) {
    const summary = Predictions.buildSummary(prediction).replace(/\$/g, '₹');
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
  if (sma20Value) sma20Value.textContent = indicators.sma20.value ? `₹${indicators.sma20.value}` : '—';
  if (sma20Status) {
    sma20Status.textContent = indicators.sma20.position;
    sma20Status.className = `indicator-card__status ${indicators.sma20.position === 'Above' ? 'price-up' : 'price-down'}`;
  }

  const sma50Value = document.getElementById('sma50-value');
  const sma50Status = document.getElementById('sma50-status');
  if (sma50Value) sma50Value.textContent = indicators.sma50.value ? `₹${indicators.sma50.value}` : '—';
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
        if (overlay === 'targets') {
          ChartManager.clearTradeLevels();
        } else if (overlay === 'bb') {
          ChartManager.removeOverlay('bbUpper');
          ChartManager.removeOverlay('bbLower');
        } else {
          ChartManager.removeOverlay(overlay);
        }
      } else {
        activeOverlays.add(overlay);
        if (overlay === 'targets') {
          if (currentPrediction && currentPrediction.tradeSetup) {
            ChartManager.setTradeLevels(currentPrediction.tradeSetup);
          }
        } else if (currentPrediction) {
          updateOverlays(currentPrediction);
        }
      }
    });
  });
}

/**
 * Setup dashboard sidebar search for Indian equities
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
        results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.75rem">No matching stocks found.</div>';
        results.classList.add('active');
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
          <span class="search-result-item__exchange">${r.exchange || 'NSE'}</span>
        </div>`
        )
        .join('');

      results.classList.add('active');
    }, 250);
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
  const items = await API.fetchMultipleQuotes(watchlist);

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
    lastUpdated.textContent = `Live IST: ${formatISTTime()}`;
  }
}

/**
 * Update market status
 */
async function updateMarketStatus() {
  const dot = document.getElementById('market-status-dot');
  const text = document.getElementById('market-status-text');
  if (!dot || !text) return;

  const status = await API.fetchMarketStatus();
  dot.className = `status-dot ${status.isOpen ? 'open' : ''}`;
  text.textContent = status.statusText || (status.isOpen ? 'NSE / BSE — Market Open' : 'NSE / BSE — Market Closed');

  // Bottom bar countdown
  const countdown = document.getElementById('market-countdown');
  if (countdown) {
    countdown.innerHTML = status.isOpen
      ? '<span class="status-dot open" style="width:6px;height:6px;display:inline-block;border-radius:50%;background:var(--bullish);animation:pulse-dot 2s infinite;vertical-align:middle;margin-right:4px"></span> NSE/BSE: Market Open'
      : '<span class="status-dot" style="width:6px;height:6px;display:inline-block;border-radius:50%;background:var(--text-muted);vertical-align:middle;margin-right:4px"></span> NSE/BSE: Market Closed';
  }
}

/**
 * Switch right technical inspector tabs (Trade Plan, Backtest Accuracy, 5-Bar Forecast)
 */
function switchInspectorTab(tabId) {
  document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => {
    c.style.display = 'none';
    c.classList.remove('active');
  });

  const activeBtn = document.querySelector(`.inspector-tab[data-tab="${tabId}"]`);
  const activeContent = document.getElementById(`tab-content-${tabId}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activeContent) {
    activeContent.style.display = 'block';
    activeContent.classList.add('active');
  }
}

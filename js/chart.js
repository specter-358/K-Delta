/* ============================================================
   K-Delta — Professional Candlestick Chart Engine
   Wraps TradingView Lightweight Charts with Real-Time Streams,
   Overlays (VWAP, EMA, SMA, BB, S/R, Trendlines) & Pattern Markers
   ============================================================ */

const ChartManager = (() => {
  let chart = null;
  let candleSeries = null;
  let lineSeries = null;
  let volumeSeries = null;
  let currentChartType = (typeof localStorage !== 'undefined' && localStorage.getItem('kdelta_chart_type')) || 'candlestick';
  let lastFormattedCandles = [];
  let isToggling = false;
  let overlayLines = {};
  let tradePriceLines = [];
  let srPriceLines = [];
  let currentCandles = [];
  let isIntraday = false;
  let containerEl = null;
  let isVolumeVisible = true;
  let cachedVolumes = [];
  let pendingCandles = null;
  let cachedTradeMarkers = [];
  let cachedPatternMarkers = [];

  const OVERLAY_CONFIGS = {
    sma20: { color: '#f59e0b', lineWidth: 2, title: 'SMA 20' },
    sma50: { color: '#38bdf8', lineWidth: 2, title: 'SMA 50' },
    sma200: { color: '#a855f7', lineWidth: 2, title: 'SMA 200' },
    ema12: { color: '#06b6d4', lineWidth: 1.5, title: 'EMA 12' },
    ema26: { color: '#818cf8', lineWidth: 1.5, title: 'EMA 26' },
    vwap: { color: '#ec4899', lineWidth: 2, title: 'VWAP' },
    bbUpper: { color: 'rgba(56, 189, 248, 0.75)', lineWidth: 1.5, title: 'BB Upper' },
    bbLower: { color: 'rgba(56, 189, 248, 0.75)', lineWidth: 1.5, title: 'BB Lower' },
    trendUpper: { color: '#f43f5e', lineWidth: 1.5, title: 'Resistance Trendline' },
    trendLower: { color: '#10b981', lineWidth: 1.5, title: 'Support Trendline' },
  };

  const IST_OFFSET_SECONDS = 19800; // 5 hours 30 minutes in seconds (IST = UTC+05:30)

  /**
   * Format time for Lightweight Charts
   * Lightweight Charts operates in UTC internally.
   * To display authentic Indian Standard Time (IST, UTC+05:30) across all intraday
   * timeframes on both the bottom time scale axis and crosshairs,
   * unix epoch seconds are shifted forward by +19,800 seconds (+5:30).
   */
  function formatTime(timeVal) {
    if (timeVal == null) return timeVal;
    if (typeof timeVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timeVal.trim())) {
      return timeVal.trim();
    }
    if (typeof timeVal === 'object' && timeVal.year && timeVal.month && timeVal.day) {
      return `${timeVal.year}-${String(timeVal.month).padStart(2, '0')}-${String(timeVal.day).padStart(2, '0')}`;
    }

    let sec = null;
    if (typeof timeVal === 'number') {
      sec = Math.floor(timeVal);
    } else if (typeof timeVal === 'string' && /^\d{9,12}$/.test(timeVal.trim())) {
      sec = parseInt(timeVal.trim(), 10);
    } else {
      const d = new Date(timeVal);
      if (!isNaN(d.getTime())) {
        sec = Math.floor(d.getTime() / 1000);
      }
    }

    if (sec != null) {
      return sec + IST_OFFSET_SECONDS;
    }
    return timeVal;
  }

  /**
   * Initialize Chart in container
   */
  function init(container) {
    if (typeof LightweightCharts === 'undefined') {
      console.warn('[ChartManager] LightweightCharts not loaded yet, retrying in 100ms...');
      setTimeout(() => init(container), 100);
      return;
    }

    if (chart) {
      chart.remove();
      chart = null;
    }

    containerEl = container;
    const bgColor = '#000000';
    const textColor = '#94a3b8';
    const gridColor = 'rgba(255, 255, 255, 0.04)';
    const borderColor = 'rgba(255, 255, 255, 0.08)';

    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth || 800,
      height: container.clientHeight || 560,
      layout: {
        background: { type: 'solid', color: bgColor },
        textColor: textColor,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      localization: {
        priceFormatter: price => '₹' + price.toFixed(2),
        timeFormatter: timestamp => {
          if (typeof timestamp === 'number') {
            const d = new Date(timestamp * 1000);
            return d.toLocaleString('en-IN', {
              timeZone: 'UTC', // Timestamp is shifted by +19,800s to IST; format with UTC to preserve exact IST time
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
              day: '2-digit',
              month: 'short',
            });
          }
          if (typeof timestamp === 'object' && timestamp.year) {
            return `${String(timestamp.day).padStart(2, '0')}/${String(timestamp.month).padStart(2, '0')}/${timestamp.year}`;
          }
          return timestamp;
        },
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#000000',
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#000000',
        },
      },
      rightPriceScale: {
        borderColor: borderColor,
        scaleMargins: { top: 0.08, bottom: 0.22 },
        alignLabels: true,
        autoScale: true,
      },
      timeScale: {
        borderColor: borderColor,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          if (typeof time === 'number') {
            const d = new Date(time * 1000);
            if (tickMarkType === 0) return String(d.getUTCFullYear());
            if (tickMarkType === 1) return d.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' });
            if (tickMarkType === 2) return String(d.getUTCDate());
            const h = String(d.getUTCHours()).padStart(2, '0');
            const m = String(d.getUTCMinutes()).padStart(2, '0');
            return `${h}:${m}`;
          }
          if (typeof time === 'object' && time.year) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (tickMarkType === 1) return months[(time.month || 1) - 1];
            if (tickMarkType === 0) return String(time.year);
            return `${time.day} ${months[(time.month || 1) - 1]}`;
          }
          return String(time);
        },
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series (Indian Markets: Emerald Teal & Crimson Coral)
    candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceLineVisible: true,
      priceLineColor: '#38bdf8',
      priceLineWidth: 1,
      priceLineStyle: LightweightCharts.LineStyle.Dashed,
      lastValueVisible: true,
      visible: currentChartType === 'candlestick',
    });

    // Area / Line Series (Smooth Line Chart with Cyan Gradient)
    lineSeries = chart.addAreaSeries({
      topColor: 'rgba(56, 189, 248, 0.28)',
      bottomColor: 'rgba(56, 189, 248, 0.01)',
      lineColor: '#38bdf8',
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: '#38bdf8',
      priceLineWidth: 1,
      priceLineStyle: LightweightCharts.LineStyle.Dashed,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      visible: currentChartType === 'line',
    });

    // Volume series (overlay without polluting price axis)
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay on same scale with bottom margins
      scaleMargins: { top: 0.82, bottom: 0 },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Crosshair move handler for OHLC display bar
    chart.subscribeCrosshairMove(param => {
      const ohlcEl = document.getElementById('chart-live-ohlc');
      if (!ohlcEl) return;

      if (!param || !param.time || !param.seriesPrices) {
        updateOHLCDisplay(null);
        return;
      }

      let bar = param.seriesPrices.get(candleSeries);
      if (!bar && lineSeries) {
        const lineVal = param.seriesPrices.get(lineSeries);
        if (lineVal != null && !isNaN(lineVal)) {
          bar = { open: lineVal, high: lineVal, low: lineVal, close: lineVal };
        }
      }
      updateOHLCDisplay(bar);
    });

    // Handle responsive resize with ResizeObserver for immediate auto-adjust
    if (window.ResizeObserver && container) {
      const ro = new ResizeObserver(() => {
        handleResize();
      });
      ro.observe(container);
    }

    window.addEventListener('resize', handleResize);

    if (pendingCandles && pendingCandles.length > 0) {
      setData(pendingCandles);
      pendingCandles = null;
    }

    updateChartTypeButtonUI(currentChartType);
  }

  function handleResize() {
    if (chart && containerEl) {
      const w = containerEl.clientWidth;
      const h = containerEl.clientHeight;
      if (w > 0 && h > 0) {
        chart.applyOptions({
          width: w,
          height: h,
        });
        chart.timeScale().fitContent();
      }
    }
  }

  function updateOHLCDisplay(bar) {
    const ohlcEl = document.getElementById('chart-live-ohlc');
    if (!ohlcEl) return;

    if (!bar && currentCandles.length > 0) {
      const last = currentCandles[currentCandles.length - 1];
      bar = { open: last.open, high: last.high, low: last.low, close: last.close };
    }

    if (!bar) {
      ohlcEl.innerHTML = '';
      return;
    }

    const isUp = bar.close >= bar.open;
    const colorClass = isUp ? 'price-up' : 'price-down';

    ohlcEl.innerHTML = `
      <span style="color:var(--text-muted)">O:</span> <strong>₹${bar.open.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">H:</span> <strong>₹${bar.high.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">L:</span> <strong>₹${bar.low.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">C:</span> <strong class="${colorClass}">₹${bar.close.toFixed(2)}</strong>
    `;
  }

  /**
   * Set complete historical candle data
   */
  function setData(candles) {
    if (!candles || candles.length === 0) return;
    if (!chart || !candleSeries) {
      pendingCandles = candles;
      return;
    }

    currentCandles = [...candles];
    isIntraday = typeof candles[0].time === 'number';

    const seenTimes = new Set();
    const formattedCandles = [];
    const formattedVolumes = [];

    for (const c of candles) {
      if (!c || c.time == null || c.open == null || c.high == null || c.low == null || c.close == null) continue;
      const t = formatTime(c.time);
      const tKey = typeof t === 'object' ? JSON.stringify(t) : String(t);
      if (!seenTimes.has(tKey)) {
        seenTimes.add(tKey);
        formattedCandles.push({
          time: t,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        });
        formattedVolumes.push({
          time: t,
          value: Number(c.volume) || 10,
          color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
        });
      }
    }

    formattedCandles.sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      return String(a.time).localeCompare(String(b.time));
    });

    formattedVolumes.sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      return String(a.time).localeCompare(String(b.time));
    });

    lastFormattedCandles = formattedCandles;
    candleSeries.setData(formattedCandles);
    if (lineSeries) {
      lineSeries.setData(formattedCandles.map(c => ({
        time: c.time,
        value: c.close,
      })));
    }
    cachedVolumes = formattedVolumes;
    if (volumeSeries) {
      volumeSeries.setData(isVolumeVisible ? formattedVolumes : []);
    }

    // Default time scale visibility and spacing (matching TradingView India view)
    chart.timeScale().applyOptions({
      timeVisible: isIntraday,
      barSpacing: isIntraday ? 9 : 6,
      rightOffset: 6,
    });

    if (isIntraday) {
      try {
        chart.timeScale().scrollToRealtime();
      } catch (e) {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }
    updateOHLCDisplay(null);
  }

  /**
   * Set Volume Histogram Visibility
   */
  function setVolumeVisibility(visible) {
    isVolumeVisible = visible;
    if (!volumeSeries) return;
    try {
      volumeSeries.setData(visible ? cachedVolumes : []);
    } catch (e) {}
  }

  /**
   * Update the currently forming candle dynamically from live WebSocket tick
   */
  function updateLiveCandle(candle) {
    if (!candleSeries || !candle || candle.time == null) return;

    try {
      const formattedTimeKey = formatTime(candle.time);
      if (currentCandles.length > 0) {
        const last = currentCandles[currentCandles.length - 1];
        const lastTime = formatTime(last.time);
        
        // LightweightCharts throws if time is older than the last bar
        if (typeof formattedTimeKey === 'number' && typeof lastTime === 'number' && formattedTimeKey < lastTime) {
          return;
        }
        if (typeof formattedTimeKey === 'string' && typeof lastTime === 'string' && formattedTimeKey < lastTime) {
          return;
        }
      }

      const barData = {
        time: formattedTimeKey,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };

      candleSeries.update(barData);

      if (lineSeries) {
        lineSeries.update({
          time: formattedTimeKey,
          value: Number(candle.close),
        });
      }

      if (volumeSeries && candle.volume) {
        volumeSeries.update({
          time: formattedTimeKey,
          value: Number(candle.volume),
          color: candle.close >= candle.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
        });
      }

      // Update current candles cache
      if (currentCandles.length > 0) {
        const last = currentCandles[currentCandles.length - 1];
        const lastFormatted = String(formatTime(last.time));
        const curFormatted = String(formattedTimeKey);

        if (lastFormatted === curFormatted || last.time === candle.time) {
          last.high = Math.max(last.high, Number(candle.high));
          last.low = Math.min(last.low, Number(candle.low));
          last.close = Number(candle.close);
          last.volume = candle.volume;
        } else {
          currentCandles.push({ ...candle, time: candle.time });
        }
      }

      updateOHLCDisplay(barData);
    } catch (err) {
      // Gracefully prevent tick sequence race conditions from stalling the engine
    }
  }

  /**
   * Set Technical Overlay (SMA, EMA, VWAP, BB, S/R, Trendline)
   */
  function setOverlay(name, dataPoints) {
    if (!chart || !dataPoints || !dataPoints.length) return;

    try {
      const config = OVERLAY_CONFIGS[name] || { color: '#38bdf8', lineWidth: 1.5, title: name };
      
      let overlaySeries = overlayLines[name];
      if (!overlaySeries) {
        overlaySeries = chart.addLineSeries({
          color: config.color,
          lineWidth: config.lineWidth || 1.5,
          title: config.title || name,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        });
        overlayLines[name] = overlaySeries;
      }

      const validPoints = dataPoints.filter(p => p && p.time != null && p.value != null && !isNaN(p.value));
      const seenTimes = new Set();
      const formattedData = [];

      for (const p of validPoints) {
        const t = formatTime(p.time);
        const tKey = typeof t === 'object' ? JSON.stringify(t) : String(t);
        if (!seenTimes.has(tKey)) {
          seenTimes.add(tKey);
          formattedData.push({ time: t, value: Number(p.value) });
        }
      }

      formattedData.sort((a, b) => {
        if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
        return String(a.time).localeCompare(String(b.time));
      });

      if (formattedData.length > 0) {
        overlaySeries.setData(formattedData);
      }
    } catch (err) {
      console.warn(`Error setting overlay ${name}:`, err);
    }
  }

  /**
   * Remove a specific overlay
   */
  function removeOverlay(name) {
    if (overlayLines[name]) {
      try {
        chart.removeSeries(overlayLines[name]);
      } catch (e) {}
      delete overlayLines[name];
    }
  }

  /**
   * Clear all active overlays
   */
  function clearAllOverlays() {
    Object.keys(overlayLines).forEach(name => {
      removeOverlay(name);
    });
    overlayLines = {};
  }

  /**
   * Combined marker updater ensuring all markers (Trade Lifecycle + Patterns)
   * are strictly sorted by time ascending for TradingView Lightweight Charts
   */
  function updateCombinedMarkers() {
    if (!candleSeries) return;

    const allMarkers = [];

    // Add Trade Lifecycle Markers (Entry BUY / Exit SELL)
    if (cachedTradeMarkers && cachedTradeMarkers.length > 0) {
      allMarkers.push(...cachedTradeMarkers);
    }

    // Add Pattern Markers if present
    if (cachedPatternMarkers && cachedPatternMarkers.length > 0) {
      allMarkers.push(...cachedPatternMarkers);
    }

    // Sort strictly ascending by time for Lightweight Charts
    allMarkers.sort((a, b) => {
      const timeA = typeof a.time === 'number' ? a.time : (new Date(a.time).getTime() / 1000);
      const timeB = typeof b.time === 'number' ? b.time : (new Date(b.time).getTime() / 1000);
      return timeA - timeB;
    });

    try {
      const targetSeries = currentChartType === 'line' ? lineSeries : candleSeries;
      if (targetSeries) {
        targetSeries.setMarkers(allMarkers);
      }
      const otherSeries = currentChartType === 'line' ? candleSeries : lineSeries;
      if (otherSeries) {
        try { otherSeries.setMarkers([]); } catch (e) {}
      }
    } catch (e) {
      console.warn('Error setting chart markers:', e);
    }
  }

  /**
   * Display Intraday Trade Lifecycle Markers (BUY @ ₹... / SELL: Reason (+X%))
   */
  function setTradeMarkers(tradeList) {
    if (!tradeList || !Array.isArray(tradeList) || tradeList.length === 0) {
      cachedTradeMarkers = [];
      updateCombinedMarkers();
      return;
    }

    cachedTradeMarkers = tradeList.map(t => {
      const isBuy = t.type === 'BUY';
      const isWin = (t.pnlPct || 0) >= 0;
      return {
        time: formatTime(t.time),
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#10b981' : (isWin ? '#10b981' : '#f43f5e'),
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: t.text || (isBuy ? `BUY @ ₹${t.price}` : `SELL: ${t.reason || 'Exit'}`),
        size: 2,
      };
    });

    updateCombinedMarkers();
  }

  /**
   * Clear Trade Lifecycle Markers
   */
  function clearTradeMarkers() {
    cachedTradeMarkers = [];
    updateCombinedMarkers();
  }

  /**
   * Display Pattern Markers directly on chart candles
   */
  function setPatternMarkers(patternList) {
    if (!patternList || !Array.isArray(patternList) || patternList.length === 0) {
      cachedPatternMarkers = [];
      updateCombinedMarkers();
      return;
    }

    // Deduplicate by time and keep highest confidence pattern per bar
    const uniqueByTime = new Map();
    patternList.forEach(p => {
      const timeKey = String(formatTime(p.timestamp));
      if (!uniqueByTime.has(timeKey) || uniqueByTime.get(timeKey).confidence < p.confidence) {
        uniqueByTime.set(timeKey, p);
      }
    });

    cachedPatternMarkers = Array.from(uniqueByTime.values()).map(p => {
      const isBullish = p.signal === 'bullish';
      const isBearish = p.signal === 'bearish';

      return {
        time: formatTime(p.timestamp),
        position: isBullish ? 'belowBar' : isBearish ? 'aboveBar' : 'inBar',
        color: isBullish ? '#34d399' : isBearish ? '#fb7185' : '#f59e0b',
        shape: isBullish ? 'arrowUp' : isBearish ? 'arrowDown' : 'circle',
        text: `${p.name} (${p.confidence}%)`,
        size: 1,
      };
    });

    updateCombinedMarkers();
  }

  /**
   * Clear Pattern Markers from chart candles
   */
  function clearPatternMarkers() {
    cachedPatternMarkers = [];
    updateCombinedMarkers();
  }

  let lastTradeSetup = null;

  function clearTradeLevels() {
    tradePriceLines.forEach(item => {
      try {
        if (item && item.series && item.line) item.series.removePriceLine(item.line);
        else if (item && item.line && candleSeries) candleSeries.removePriceLine(item.line);
      } catch (e) {}
    });
    tradePriceLines = [];
    lastTradeSetup = null;
  }

  function addTradePriceLine(options) {
    const targetSeries = (currentChartType === 'line' ? lineSeries : candleSeries) || candleSeries;
    if (targetSeries) {
      try {
        const line = targetSeries.createPriceLine(options);
        tradePriceLines.push({ series: targetSeries, line });
      } catch (e) {}
    }
  }

  let activeSignalPriceLine = null;
  let lastSignalState = null;

  function clearSignalPriceLine() {
    if (activeSignalPriceLine) {
      try {
        if (activeSignalPriceLine.series && activeSignalPriceLine.line) {
          activeSignalPriceLine.series.removePriceLine(activeSignalPriceLine.line);
        }
      } catch (e) {}
      activeSignalPriceLine = null;
    }
    // Restore clean default LTP price line on base series
    try {
      const defaultOpts = {
        priceLineVisible: true,
        priceLineColor: '#38bdf8',
        priceLineWidth: 1,
        priceLineStyle: LightweightCharts.LineStyle.Dashed,
      };
      if (candleSeries) candleSeries.applyOptions(defaultOpts);
      if (lineSeries) lineSeries.applyOptions(defaultOpts);
    } catch (e) {}
  }

  /**
   * Configure Signal Price Line visibility and distinct recognition color
   * Ensures every stock ALWAYS has its current market price (LTP) line visible.
   * When an active signal (BUY, SELL, EXIT) occurs, renders a highlighted signal line
   * without duplicate overlapping lines or stacked axis price badges.
   */
  function setSignalPriceLine(signalState) {
    clearSignalPriceLine();
    lastSignalState = signalState;
    if (!candleSeries && !lineSeries) return;

    if (!signalState || !signalState.hasSignal) {
      // Standard stock state (no active signal / consolidation / hold):
      // Keep standard current LTP price line clearly visible on all stocks!
      try {
        const stdOpts = {
          priceLineVisible: true,
          priceLineColor: '#38bdf8',
          priceLineWidth: 1,
          priceLineStyle: LightweightCharts.LineStyle.Dashed,
        };
        if (candleSeries) candleSeries.applyOptions(stdOpts);
        if (lineSeries) lineSeries.applyOptions(stdOpts);
      } catch (e) {}
      return;
    }

    // Active Signal detected:
    // Color scheme:
    // BUY: Electric Sky Cyan (#00e5ff) - stands out boldly from emerald green (#10b981) candles!
    // SELL: Vibrant Neon Coral (#ff6b35) - stands out boldly from crimson (#f43f5e) candles!
    // EXIT: Vivid Amber Gold (#fbbf24)
    let color = '#00e5ff';
    let titlePrefix = 'BUY SIGNAL';
    if (signalState.type === 'SELL') {
      color = '#ff6b35';
      titlePrefix = 'SELL SIGNAL';
    } else if (signalState.type === 'EXIT') {
      color = '#fbbf24';
      titlePrefix = 'EXIT SIGNAL';
    } else if (signalState.type === 'BUY') {
      color = '#00e5ff';
      titlePrefix = 'BUY SIGNAL';
    }

    try {
      // If targets overlay is active, setTradeLevels already draws the Entry line with its label,
      // so style the series price line cleanly without adding duplicate title line.
      if (signalState.isTargetsActive) {
        const opts = {
          priceLineVisible: true,
          priceLineColor: color,
          priceLineWidth: 1.5,
          priceLineStyle: LightweightCharts.LineStyle.Dashed,
        };
        if (candleSeries) candleSeries.applyOptions(opts);
        if (lineSeries) lineSeries.applyOptions(opts);
        return;
      }

      // Draw custom signal price line with actionable title badge:
      // Turn off default series priceLine during active signal to avoid duplicate stacked axis badges!
      if (candleSeries) candleSeries.applyOptions({ priceLineVisible: false });
      if (lineSeries) lineSeries.applyOptions({ priceLineVisible: false });

      const targetSeries = (currentChartType === 'line' ? lineSeries : candleSeries) || candleSeries;
      const lastCandle = (currentCandles && currentCandles.length > 0) ? currentCandles[currentCandles.length - 1] : null;
      const priceVal = (signalState.price && signalState.price > 0) ? signalState.price : (lastCandle ? lastCandle.close : null);

      if (targetSeries && priceVal) {
        const line = targetSeries.createPriceLine({
          price: priceVal,
          color: color,
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${titlePrefix} @ ₹${priceVal.toFixed(2)}`,
        });
        activeSignalPriceLine = { series: targetSeries, line };
      }
    } catch (e) {
      console.warn('Error updating signal price line:', e);
    }
  }

  /**
   * Shift chart view to upper/focal area so the trader sees the active signal early
   */
  function focusSignalView() {
    if (!chart) return;
    try {
      chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.12, bottom: 0.28 },
        autoScale: true,
      });
      chart.timeScale().scrollToRealTime();
    } catch (e) {}
  }

  /**
   * Set Horizontal Trade Price Lines (Entry, TP1, TP2, SL)
   * Displays full Execution Targets (Entry, Target 1, Target 2, Stop Loss) with percentages.
   */
  function setTradeLevels(setup) {
    clearTradeLevels();
    if (!candleSeries && !lineSeries) return;
    if (!setup) return;

    lastTradeSetup = setup;

    try {
      let entry = setup.entryPrice ? parseFloat(setup.entryPrice) : null;
      let target1 = setup.target1 ? parseFloat(setup.target1) : null;
      let target2 = setup.target2 ? parseFloat(setup.target2) : null;
      let stopLoss = setup.stopLoss ? parseFloat(setup.stopLoss) : null;
      const isPositionOpen = setup.positionStatus === 'OPEN_LONG';
      const isBuy = setup.type === 'BUY' || setup.type === 'BUY STOCK' || isPositionOpen || (setup.signal && setup.signal.includes('BUY'));
      const isSell = setup.type === 'SELL' || setup.type === 'SELL STOCK' || (setup.signal && setup.signal.includes('SELL'));

      // If entry is missing, derive from latest candle
      if (!entry && currentCandles && currentCandles.length > 0) {
        entry = parseFloat(currentCandles[currentCandles.length - 1].close);
      }

      // If targets are missing, compute ATR-based levels
      if (entry && (!target1 || !stopLoss)) {
        const validAtr = entry * 0.015;
        if (isSell) {
          if (!target1) target1 = +(entry - validAtr * 1.5).toFixed(2);
          if (!target2) target2 = +(entry - validAtr * 3.0).toFixed(2);
          if (!stopLoss) stopLoss = +(entry + validAtr * 1.0).toFixed(2);
        } else {
          if (!target1) target1 = +(entry + validAtr * 1.5).toFixed(2);
          if (!target2) target2 = +(entry + validAtr * 3.0).toFixed(2);
          if (!stopLoss) stopLoss = +(entry - validAtr * 1.0).toFixed(2);
        }
      }

      // Distinct color for recognition
      const entryColor = isPositionOpen ? '#38bdf8' : (isBuy ? '#00e5ff' : (isSell ? '#ff6b35' : '#38bdf8'));

      if (entry) {
        const entryTitle = isPositionOpen
          ? `BOUGHT @ ₹${entry.toFixed(2)}`
          : (isBuy ? `BUY ENTRY: ₹${entry.toFixed(2)}` : (isSell ? `SELL ENTRY: ₹${entry.toFixed(2)}` : `ENTRY: ₹${entry.toFixed(2)}`));
        addTradePriceLine({
          price: entry,
          color: entryColor,
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: entryTitle,
        });
      }

      if (target1) {
        const pct = entry ? (((target1 - entry) / entry) * 100).toFixed(1) : null;
        const pctStr = pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : '';
        addTradePriceLine({
          price: target1,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TARGET 1 (TP1): ₹${target1.toFixed(2)}${pctStr}`,
        });
      }

      if (target2) {
        const pct = entry ? (((target2 - entry) / entry) * 100).toFixed(1) : null;
        const pctStr = pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : '';
        addTradePriceLine({
          price: target2,
          color: '#059669',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: `TARGET 2 (TP2): ₹${target2.toFixed(2)}${pctStr}`,
        });
      }

      if (stopLoss) {
        const pct = entry ? (((stopLoss - entry) / entry) * 100).toFixed(1) : null;
        const pctStr = pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : '';
        addTradePriceLine({
          price: stopLoss,
          color: '#f43f5e',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `STOP LOSS (SL): ₹${stopLoss.toFixed(2)}${pctStr}`,
        });
      }
    } catch (e) {
      console.warn('Error setting trade levels:', e);
    }
  }

  /**
   * Clear Support / Resistance Price Lines
   */
  function clearSupportResistanceLevels() {
    srPriceLines.forEach(item => {
      try {
        if (item.series && item.line) item.series.removePriceLine(item.line);
        else if (candleSeries) candleSeries.removePriceLine(item);
      } catch (e) {}
    });
    srPriceLines = [];
  }

  function addSrPriceLine(options) {
    if (candleSeries) {
      try {
        const line = candleSeries.createPriceLine(options);
        srPriceLines.push({ series: candleSeries, line });
      } catch (e) {}
    }
    if (lineSeries) {
      try {
        const line = lineSeries.createPriceLine(options);
        srPriceLines.push({ series: lineSeries, line });
      } catch (e) {}
    }
  }

  /**
   * Set Support / Resistance Price Lines
   */
  function setSupportResistanceLevels(levels) {
    clearSupportResistanceLevels();
    if ((!candleSeries && !lineSeries) || !levels) return;

    try {
      if (levels.support) {
        levels.support.forEach((price, idx) => {
          addSrPriceLine({
            price,
            color: 'rgba(16, 185, 129, 0.75)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: `S${idx + 1} Support`,
          });
        });
      }

      if (levels.resistance) {
        levels.resistance.forEach((price, idx) => {
          addSrPriceLine({
            price,
            color: 'rgba(244, 63, 94, 0.75)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: `R${idx + 1} Resistance`,
          });
        });
      }
    } catch (e) {
      console.warn('Error setting S/R levels:', e);
    }
  }

  function updateTheme(theme) {
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { type: 'solid', color: '#080b11' },
        textColor: '#94a3b8',
      },
    });
  }

  function takeScreenshot() {
    if (!chart) return null;
    try {
      if (typeof chart.takeScreenshot === 'function') {
        return chart.takeScreenshot();
      }
    } catch (e) {
      console.warn('chart.takeScreenshot error:', e);
    }
    // Fallback to container canvas element
    if (containerEl) {
      return containerEl.querySelector('canvas');
    }
    return null;
  }

  function handleResize() {
    if (!chart || !containerEl) return;
    try {
      chart.applyOptions({
        width: containerEl.clientWidth || 800,
        height: containerEl.clientHeight || 560,
      });
    } catch (e) {
      console.warn('handleResize error:', e);
    }
  }

  function autoFit() {
    if (!chart) return;
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    } catch (e) {
      console.warn('autoFit error:', e);
    }
  }

  function setChartType(type) {
    if (type !== 'candlestick' && type !== 'line') return;
    currentChartType = type;
    try {
      localStorage.setItem('kdelta_chart_type', type);
    } catch (e) {}

    if (candleSeries) {
      candleSeries.applyOptions({ visible: type === 'candlestick' });
    }
    if (lineSeries) {
      lineSeries.applyOptions({ visible: type === 'line' });
      if (type === 'line' && lastFormattedCandles && lastFormattedCandles.length > 0) {
        try {
          lineSeries.setData(lastFormattedCandles.map(c => ({
            time: c.time,
            value: Number(c.close),
          })));
        } catch (e) {}
      }
    }

    if (chart) {
      try {
        chart.priceScale('right').applyOptions({ autoScale: true });
      } catch (e) {}
    }

    updateCombinedMarkers();
    if (lastTradeSetup) {
      setTradeLevels(lastTradeSetup);
    }
    if (lastSignalState) {
      setSignalPriceLine(lastSignalState);
    }
    updateChartTypeButtonUI(type);

    if (typeof showToast === 'function') {
      showToast(type === 'line' ? 'Switched to Line Chart' : 'Switched to Candlestick Chart', 'info');
    }
  }

  function getChartType() {
    return currentChartType;
  }

  function toggleChartType() {
    if (isToggling) return currentChartType;
    isToggling = true;
    setTimeout(() => { isToggling = false; }, 200);

    const next = currentChartType === 'candlestick' ? 'line' : 'candlestick';
    setChartType(next);
    return next;
  }

  function updateChartTypeButtonUI(type) {
    const btn = document.getElementById('btn-chart-type');
    const iconSpan = document.getElementById('chart-type-icon');
    if (!btn || !iconSpan) return;

    if (type === 'line') {
      btn.title = 'Current: Line Chart (Click to switch to Candlestick Chart)';
      btn.classList.add('active', 'chart-type--line');
      btn.classList.remove('chart-type--candles');
      iconSpan.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
      `;
    } else {
      btn.title = 'Current: Candlestick Chart (Click to switch to Line Chart)';
      btn.classList.add('active', 'chart-type--candles');
      btn.classList.remove('chart-type--line');
      iconSpan.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="9" y1="2" x2="9" y2="22"></line>
          <rect x="6" y="6" width="6" height="12" fill="currentColor" fill-opacity="0.3"></rect>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <rect x="14" y="10" width="6" height="7" fill="currentColor" fill-opacity="0.3"></rect>
        </svg>
      `;
    }
  }

  function destroy() {
    if (chart) {
      try {
        chart.remove();
      } catch (e) {}
      chart = null;
    }
    candleSeries = null;
    lineSeries = null;
    volumeSeries = null;
    overlayLines = {};
    tradePriceLines = [];
    srPriceLines = [];
    currentCandles = [];
    cachedTradeMarkers = [];
    cachedPatternMarkers = [];
  }

  return {
    init,
    setData,
    updateLiveCandle,
    setChartType,
    getChartType,
    toggleChartType,
    updateChartTypeButtonUI,
    setOverlay,
    removeOverlay,
    clearAllOverlays,
    setTradeMarkers,
    clearTradeMarkers,
    setPatternMarkers,
    clearPatternMarkers,
    setVolumeVisibility,
    setSignalPriceLine,
    focusSignalView,
    setTradeLevels,
    clearTradeLevels,
    setSupportResistanceLevels,
    clearSupportResistanceLevels,
    takeScreenshot,
    updateTheme,
    handleResize,
    autoFit,
    destroy,
  };
})();

// Expose globally on window so inline onclick and external scripts can access
if (typeof window !== 'undefined') {
  window.ChartManager = ChartManager;
}

function toggleChartType() {
  if (typeof ChartManager !== 'undefined' && typeof ChartManager.toggleChartType === 'function') {
    return ChartManager.toggleChartType();
  }
  if (typeof window !== 'undefined' && window.ChartManager && typeof window.ChartManager.toggleChartType === 'function') {
    return window.ChartManager.toggleChartType();
  }
}

if (typeof window !== 'undefined') {
  window.toggleChartType = toggleChartType;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChartManager;
}

/* ============================================================
   K-Delta — Chart Wrapper
   Wraps TradingView Lightweight Charts library with IST localization
   ============================================================ */

const ChartManager = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let overlayLines = {};
  let markers = [];
  let currentIsIntraday = false;

  const OVERLAY_COLORS = {
    sma20: { color: '#ffd740', title: 'SMA 20' },
    sma50: { color: '#ff6d00', title: 'SMA 50' },
    ema12: { color: '#00e5ff', title: 'EMA 12' },
    ema26: { color: '#d500f9', title: 'EMA 26' },
    bbUpper: { color: 'rgba(0, 212, 255, 0.3)', title: 'BB Upper' },
    bbLower: { color: 'rgba(0, 212, 255, 0.3)', title: 'BB Lower' },
  };

  /**
   * Format time for Lightweight Charts
   * Supports:
   * - Daily/Weekly BusinessDay: "YYYY-MM-DD" or { year, month, day }
   * - Intraday Unix timestamp: number in seconds (e.g. 1789033500)
   */
  function formatTime(timeVal) {
    if (timeVal == null) return timeVal;

    // If it's already a numeric UNIX timestamp in seconds
    if (typeof timeVal === 'number') {
      return timeVal;
    }

    // If it's a numeric string timestamp (e.g., "1789033500")
    if (typeof timeVal === 'string' && /^\d{9,12}$/.test(timeVal.trim())) {
      return parseInt(timeVal.trim(), 10);
    }

    // If it's already a BusinessDay object { year, month, day }
    if (typeof timeVal === 'object' && timeVal.year && timeVal.month && timeVal.day) {
      return timeVal;
    }

    // If it's a date string "YYYY-MM-DD"
    if (typeof timeVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timeVal.trim())) {
      const [year, month, day] = timeVal.trim().split('-').map(Number);
      return { year, month, day };
    }

    // If it's an ISO timestamp string
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000);
    }

    return timeVal;
  }

  /**
   * Initialize the chart in a container
   * @param {HTMLElement} container - DOM element
   */
  function init(container) {
    if (chart) {
      chart.remove();
    }

    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#060914' },
        textColor: '#9fa8da',
        fontSize: 12,
        fontFamily: "'JetBrains Mono', 'Inter', monospace",
      },
      localization: {
        priceFormatter: price => '₹' + price.toFixed(2),
        timeFormatter: timestamp => {
          if (typeof timestamp === 'number') {
            const d = new Date(timestamp * 1000);
            return d.toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
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
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(0, 212, 255, 0.3)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#111638',
        },
        horzLine: {
          color: 'rgba(0, 212, 255, 0.3)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#111638',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: false,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series
    candleSeries = chart.addCandlestickSeries({
      upColor: '#00e676',
      downColor: '#ff1744',
      borderUpColor: '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
    });

    // Volume series (as histogram)
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);

    overlayLines = {};
    markers = [];
  }

  /**
   * Set resolution/timeframe on the chart
   */
  function setTimeframe(interval) {
    if (!chart) return;
    const isIntraday = ['1min', '1m', '5min', '5m', '15min', '15m', '1h', '60min'].includes(interval.toLowerCase());
    currentIsIntraday = isIntraday;
    chart.applyOptions({
      timeScale: {
        timeVisible: isIntraday,
        secondsVisible: false,
      },
    });
  }

  /**
   * Set candlestick data
   * @param {Array} candles - Array of {time, open, high, low, close}
   * @param {boolean} fit - Whether to fit content to screen
   */
  function setData(candles, fit = true) {
    if (!candleSeries || !Array.isArray(candles) || !candles.length) return;

    // Filter valid OHLC items and format time
    const rawFormatted = candles
      .filter(c => c && c.open != null && c.high != null && c.low != null && c.close != null && !isNaN(c.close))
      .map(c => ({
        time: formatTime(c.time),
        open: typeof c.open === 'number' ? c.open : parseFloat(c.open),
        high: typeof c.high === 'number' ? c.high : parseFloat(c.high),
        low: typeof c.low === 'number' ? c.low : parseFloat(c.low),
        close: typeof c.close === 'number' ? c.close : parseFloat(c.close),
      }));

    // Deduplicate by time key and sort ascending for Lightweight Charts requirement
    const candleMap = new Map();
    for (const c of rawFormatted) {
      const key = typeof c.time === 'object' ? `${c.time.year}-${String(c.time.month).padStart(2, '0')}-${String(c.time.day).padStart(2, '0')}` : c.time;
      candleMap.set(key, c);
    }

    const formatted = Array.from(candleMap.values()).sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      if (typeof a.time === 'object' && typeof b.time === 'object') {
        const da = new Date(a.time.year, a.time.month - 1, a.time.day).getTime();
        const db = new Date(b.time.year, b.time.month - 1, b.time.day).getTime();
        return da - db;
      }
      return 0;
    });

    if (formatted.length === 0) return;

    candleSeries.setData(formatted);
    if (fit) {
      chart.timeScale().fitContent();
    }
  }

  /**
   * Update the latest live forming candle in real time
   * @param {Object} candle - {time, open, high, low, close}
   */
  function updateCandle(candle) {
    if (!candleSeries || !candle) return;
    try {
      candleSeries.update({
        time: formatTime(candle.time),
        open: typeof candle.open === 'number' ? candle.open : parseFloat(candle.open),
        high: typeof candle.high === 'number' ? candle.high : parseFloat(candle.high),
        low: typeof candle.low === 'number' ? candle.low : parseFloat(candle.low),
        close: typeof candle.close === 'number' ? candle.close : parseFloat(candle.close),
      });
    } catch (e) {
      console.warn('Error updating candle in real-time:', e);
    }
  }

  /**
   * Set volume data
   * @param {Array} volumeData - Array of {time, value, color}
   */
  function setVolume(volumeData) {
    if (!volumeSeries || !Array.isArray(volumeData) || !volumeData.length) return;

    const rawFormatted = volumeData.map(v => ({
      time: formatTime(v.time),
      value: v.value || 0,
      color: v.color || 'rgba(0, 212, 255, 0.3)',
    }));

    // Deduplicate and sort
    const volMap = new Map();
    for (const v of rawFormatted) {
      const key = typeof v.time === 'object' ? `${v.time.year}-${String(v.time.month).padStart(2, '0')}-${String(v.time.day).padStart(2, '0')}` : v.time;
      volMap.set(key, v);
    }

    const formatted = Array.from(volMap.values()).sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      if (typeof a.time === 'object' && typeof b.time === 'object') {
        const da = new Date(a.time.year, a.time.month - 1, a.time.day).getTime();
        const db = new Date(b.time.year, b.time.month - 1, b.time.day).getTime();
        return da - db;
      }
      return 0;
    });

    volumeSeries.setData(formatted);
  }

  /**
   * Add or update an overlay line series
   * @param {string} name - Overlay name (e.g., 'sma20')
   * @param {Array} data - Array of {time, value}
   */
  function setOverlay(name, data) {
    if (!chart || !Array.isArray(data) || !data.length) return;

    const config = OVERLAY_COLORS[name] || { color: '#ffffff', title: name };

    // Remove existing if present
    if (overlayLines[name]) {
      chart.removeSeries(overlayLines[name]);
    }

    const lineSeries = chart.addLineSeries({
      color: config.color,
      lineWidth: name.startsWith('bb') ? 1 : 2,
      lineStyle: name.startsWith('bb') ? LightweightCharts.LineStyle.Dotted : LightweightCharts.LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const rawFormatted = data
      .filter(d => d && d.value != null && !isNaN(d.value))
      .map(d => ({
        time: formatTime(d.time),
        value: typeof d.value === 'number' ? d.value : parseFloat(d.value),
      }));

    // Deduplicate and sort
    const lineMap = new Map();
    for (const d of rawFormatted) {
      const key = typeof d.time === 'object' ? `${d.time.year}-${String(d.time.month).padStart(2, '0')}-${String(d.time.day).padStart(2, '0')}` : d.time;
      lineMap.set(key, d);
    }

    const formatted = Array.from(lineMap.values()).sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      if (typeof a.time === 'object' && typeof b.time === 'object') {
        const da = new Date(a.time.year, a.time.month - 1, a.time.day).getTime();
        const db = new Date(b.time.year, b.time.month - 1, b.time.day).getTime();
        return da - db;
      }
      return 0;
    });

    lineSeries.setData(formatted);
    overlayLines[name] = lineSeries;
  }

  /**
   * Remove an overlay
   */
  function removeOverlay(name) {
    if (overlayLines[name]) {
      chart.removeSeries(overlayLines[name]);
      delete overlayLines[name];
    }
  }

  /**
   * Clear all overlays
   */
  function clearOverlays() {
    Object.keys(overlayLines).forEach(name => {
      chart.removeSeries(overlayLines[name]);
    });
    overlayLines = {};
  }

  /**
   * Add pattern markers to the chart
   * @param {Array} patterns - Detected patterns with index
   * @param {Array} candles - Original candle data (to get time)
   */
  function setPatternMarkers(patterns, candles) {
    if (!candleSeries || !Array.isArray(patterns) || !Array.isArray(candles)) return;

    const markerData = patterns
      .filter(p => p.index < candles.length)
      .map(p => {
        const candle = candles[p.index];
        const isBullish = p.signal === 'bullish';
        return {
          time: formatTime(candle.time),
          position: isBullish ? 'belowBar' : 'aboveBar',
          color: isBullish ? '#00e676' : '#ff1744',
          shape: isBullish ? 'arrowUp' : 'arrowDown',
          text: p.name,
        };
      });

    // Deduplicate by time key
    const uniqueMarkers = [];
    const seenTimes = new Set();
    for (const m of markerData) {
      const key = typeof m.time === 'object' ? `${m.time.year}-${m.time.month}-${m.time.day}` : m.time;
      if (!seenTimes.has(key)) {
        seenTimes.add(key);
        uniqueMarkers.push(m);
      }
    }

    uniqueMarkers.sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      if (typeof a.time === 'object' && typeof b.time === 'object') {
        const da = new Date(a.time.year, a.time.month - 1, a.time.day).getTime();
        const db = new Date(b.time.year, b.time.month - 1, b.time.day).getTime();
        return da - db;
      }
      return 0;
    });

    candleSeries.setMarkers(uniqueMarkers);
    markers = uniqueMarkers;
  }

  let tradePriceLines = [];

  /**
   * Set visual horizontal trade target levels on the chart
   * @param {Object} setup - Trade setup object
   */
  function setTradeLevels(setup) {
    if (!candleSeries) return;
    clearTradeLevels();

    if (!setup || !setup.hasSetup) return;

    try {
      const isBuy = setup.type === 'BUY';

      // 1. Entry Line (Cyan / Blue)
      if (setup.entryPrice) {
        const entryLine = candleSeries.createPriceLine({
          price: setup.entryPrice,
          color: '#00e5ff',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: isBuy ? '🎯 BUY ENTRY' : '🎯 SELL ENTRY',
        });
        tradePriceLines.push(entryLine);
      }

      // 2. Take Profit 1 Line (Bullish Green)
      if (setup.target1) {
        const tp1Line = candleSeries.createPriceLine({
          price: setup.target1,
          color: '#00e676',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TP1 (${setup.target1Pct || ''})`,
        });
        tradePriceLines.push(tp1Line);
      }

      // 3. Take Profit 2 Line (Cyan Green / Extended Target)
      if (setup.target2) {
        const tp2Line = candleSeries.createPriceLine({
          price: setup.target2,
          color: '#00b0ff',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: `TP2 (${setup.target2Pct || ''})`,
        });
        tradePriceLines.push(tp2Line);
      }

      // 4. Stop Loss Line (Bearish Red)
      if (setup.stopLoss) {
        const slLine = candleSeries.createPriceLine({
          price: setup.stopLoss,
          color: '#ff1744',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `STOP LOSS (${setup.stopLossPct || ''})`,
        });
        tradePriceLines.push(slLine);
      }
    } catch (e) {
      console.warn('Error creating trade price lines:', e);
    }
  }

  /**
   * Clear all trade level price lines
   */
  function clearTradeLevels() {
    if (!candleSeries) return;
    tradePriceLines.forEach(line => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {}
    });
    tradePriceLines = [];
  }

  /**
   * Scroll to the latest data
   */
  function scrollToLatest() {
    if (chart) {
      chart.timeScale().scrollToRealTime();
    }
  }

  /**
   * Get the chart instance
   */
  function getChart() {
    return chart;
  }

  /**
   * Destroy the chart
   */
  function destroy() {
    if (chart) {
      clearTradeLevels();
      chart.remove();
      chart = null;
      candleSeries = null;
      volumeSeries = null;
      overlayLines = {};
    }
  }

  return {
    init,
    setTimeframe,
    setData,
    updateCandle,
    setVolume,
    setOverlay,
    removeOverlay,
    clearOverlays,
    setPatternMarkers,
    setTradeLevels,
    clearTradeLevels,
    formatTime,
    scrollToLatest,
    getChart,
    destroy,
  };
})();

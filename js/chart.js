/* ============================================================
   K-Delta — Chart Wrapper
   Clean Light Mode (Zerodha Kite / TradingView / Groww Aesthetic)
   Wraps TradingView Lightweight Charts library with IST localization
   ============================================================ */

const ChartManager = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let overlayLines = {};
  let markers = [];
  let currentIsIntraday = false;
  let containerEl = null;

  const OVERLAY_COLORS = {
    sma20: { color: '#d97706', title: 'SMA 20' },
    sma50: { color: '#2563eb', title: 'SMA 50' },
    ema12: { color: '#0284c7', title: 'EMA 12' },
    ema26: { color: '#7c3aed', title: 'EMA 26' },
    bbUpper: { color: 'rgba(37, 99, 235, 0.35)', title: 'BB Upper' },
    bbLower: { color: 'rgba(37, 99, 235, 0.35)', title: 'BB Lower' },
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

    containerEl = container;

    const isDark = (typeof getSavedTheme === 'function' ? getSavedTheme() : 'light') === 'dark';
    const bgColor = isDark ? '#0d121f' : '#ffffff';
    const textColor = isDark ? '#94a3b8' : '#334155';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9';
    const borderColor = isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0';

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
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#94a3b8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: isDark ? '#1e293b' : '#0f172a',
        },
        horzLine: {
          color: '#94a3b8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: isDark ? '#1e293b' : '#0f172a',
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
        timeVisible: false,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series (Teal/Emerald green & Crimson/Coral red)
    candleSeries = chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
    });

    // Volume series
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (container && chart) {
        chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    resizeObserver.observe(container);

    overlayLines = {};
    markers = [];
  }

  /**
   * Set resolution/timeframe on the chart
   * Controls whether time/hours are shown on the timescale
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
   * Set candlestick data and auto-fit to view
   * @param {Array} candles - Array of { time, open, high, low, close }
   * @param {boolean} fit - Whether to fit content
   */
  function setData(candles, fit = true) {
    if (!candleSeries || !Array.isArray(candles) || !candles.length) return;

    // Filter valid candles & normalize timestamp format
    const rawFormatted = candles
      .filter(c => c && c.open != null && c.high != null && c.low != null && c.close != null && !isNaN(c.close))
      .map(c => ({
        time: formatTime(c.time),
        open: typeof c.open === 'number' ? c.open : parseFloat(c.open),
        high: typeof c.high === 'number' ? c.high : parseFloat(c.high),
        low: typeof c.low === 'number' ? c.low : parseFloat(c.low),
        close: typeof c.close === 'number' ? c.close : parseFloat(c.close),
      }));

    // Deduplicate candles by time key
    const candleMap = new Map();
    for (const c of rawFormatted) {
      const key = typeof c.time === 'object' ? `${c.time.year}-${String(c.time.month).padStart(2, '0')}-${String(c.time.day).padStart(2, '0')}` : c.time;
      candleMap.set(key, c);
    }

    // Sort ascending by time
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

    // Reset price scale and fit content to new stock's price range
    if (chart) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      if (fit) {
        chart.timeScale().fitContent();
      }
      // Re-fit on next animation frame in case container size changed
      requestAnimationFrame(() => {
        if (chart) {
          chart.timeScale().fitContent();
        }
      });
    }
  }

  /**
   * Update the latest live forming candle in real time
   * @param {Object} candle - { time, open, high, low, close }
   */
  function updateCandle(candle) {
    if (!candleSeries || !candle) return;
    try {
      const formatted = {
        time: formatTime(candle.time),
        open: typeof candle.open === 'number' ? candle.open : parseFloat(candle.open),
        high: typeof candle.high === 'number' ? candle.high : parseFloat(candle.high),
        low: typeof candle.low === 'number' ? candle.low : parseFloat(candle.low),
        close: typeof candle.close === 'number' ? candle.close : parseFloat(candle.close),
      };
      candleSeries.update(formatted);
    } catch (e) {
      console.warn('Error updating candle in real-time:', e);
    }
  }

  /**
   * Set volume data
   * @param {Array} volumeData - Array of { time, value, color }
   */
  function setVolume(volumeData) {
    if (!volumeSeries || !Array.isArray(volumeData) || !volumeData.length) return;

    const rawFormatted = volumeData.map(v => ({
      time: formatTime(v.time),
      value: v.value || 0,
      color: v.color || 'rgba(8, 153, 129, 0.25)',
    }));

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
   * Set an overlay indicator line (e.g. SMA, EMA)
   * @param {string} id - Identifier ('sma20', 'sma50', 'ema12', 'ema26', 'bbUpper', 'bbLower')
   * @param {Array} data - Array of { time, value }
   */
  function setOverlay(id, data) {
    if (!chart || !Array.isArray(data) || !data.length) return;

    const config = OVERLAY_COLORS[id] || { color: '#2563eb', title: id };

    if (!overlayLines[id]) {
      overlayLines[id] = chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.title,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    const rawFormatted = data
      .filter(d => d && d.value != null && !isNaN(d.value))
      .map(d => ({
        time: formatTime(d.time),
        value: typeof d.value === 'number' ? d.value : parseFloat(d.value),
      }));

    const dataMap = new Map();
    for (const d of rawFormatted) {
      const key = typeof d.time === 'object' ? `${d.time.year}-${String(d.time.month).padStart(2, '0')}-${String(d.time.day).padStart(2, '0')}` : d.time;
      dataMap.set(key, d);
    }

    const formatted = Array.from(dataMap.values()).sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time;
      if (typeof a.time === 'object' && typeof b.time === 'object') {
        const da = new Date(a.time.year, a.time.month - 1, a.time.day).getTime();
        const db = new Date(b.time.year, b.time.month - 1, b.time.day).getTime();
        return da - db;
      }
      return 0;
    });

    if (formatted.length) {
      overlayLines[id].setData(formatted);
    }
  }

  /**
   * Remove an overlay line
   * @param {string} id
   */
  function removeOverlay(id) {
    if (overlayLines[id]) {
      chart.removeSeries(overlayLines[id]);
      delete overlayLines[id];
    }
  }

  /**
   * Clear all overlays
   */
  function clearOverlays() {
    Object.keys(overlayLines).forEach(id => {
      chart.removeSeries(overlayLines[id]);
    });
    overlayLines = {};
  }

  /**
   * Set pattern markers on candlestick bars
   * @param {Array} patterns - Detected patterns
   * @param {Array} candles - Candle data
   */
  function setPatternMarkers(patterns, candles) {
    if (!candleSeries || !Array.isArray(patterns) || !Array.isArray(candles)) return;

    const newMarkers = [];

    patterns.forEach(pattern => {
      if (pattern.candleIndex != null && candles[pattern.candleIndex]) {
        const targetCandle = candles[pattern.candleIndex];
        const isBullish = pattern.signal === 'bullish';
        const isBearish = pattern.signal === 'bearish';

        newMarkers.push({
          time: formatTime(targetCandle.time),
          position: isBullish ? 'belowBar' : isBearish ? 'aboveBar' : 'aboveBar',
          color: isBullish ? '#089981' : isBearish ? '#f23645' : '#d97706',
          shape: isBullish ? 'arrowUp' : isBearish ? 'arrowDown' : 'circle',
          text: pattern.name.length > 14 ? pattern.name.substring(0, 12) + '..' : pattern.name,
        });
      }
    });

    const markerMap = new Map();
    newMarkers.forEach(m => {
      const key = typeof m.time === 'object' ? `${m.time.year}-${m.time.month}-${m.time.day}` : m.time;
      if (!markerMap.has(key)) {
        markerMap.set(key, m);
      }
    });

    const uniqueMarkers = Array.from(markerMap.values());
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

    if (!setup || (!setup.entryPrice && !setup.target1)) return;

    try {
      const isBuy = setup.type === 'BUY';
      const isSell = setup.type === 'SELL';

      // 1. Entry Line (Blue)
      if (setup.entryPrice) {
        const entryTitle = isBuy ? '🎯 BUY ENTRY' : isSell ? '🎯 SELL ENTRY' : '🎯 ENTRY ZONE';
        const entryLine = candleSeries.createPriceLine({
          price: setup.entryPrice,
          color: '#2563eb',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: entryTitle,
        });
        tradePriceLines.push(entryLine);
      }

      // 2. Take Profit 1 Line (Bullish Green)
      if (setup.target1) {
        const tp1Line = candleSeries.createPriceLine({
          price: setup.target1,
          color: '#089981',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TP1 (${setup.target1Pct || ''})`,
        });
        tradePriceLines.push(tp1Line);
      }

      // 3. Take Profit 2 Line (Emerald Green)
      if (setup.target2) {
        const tp2Line = candleSeries.createPriceLine({
          price: setup.target2,
          color: '#059669',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: `TP2 (${setup.target2Pct || ''})`,
        });
        tradePriceLines.push(tp2Line);
      }

      // 4. Stop Loss Line (Crimson Red)
      if (setup.stopLoss) {
        const slLine = candleSeries.createPriceLine({
          price: setup.stopLoss,
          color: '#f23645',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `STOP (${setup.stopLossPct || ''})`,
        });
        tradePriceLines.push(slLine);
      }
    } catch (e) {
      console.warn('Error setting trade target lines:', e);
    }
  }

  /**
   * Clear all trade target lines from chart
   */
  function clearTradeLevels() {
    if (!candleSeries || !tradePriceLines.length) return;
    try {
      tradePriceLines.forEach(line => {
        candleSeries.removePriceLine(line);
      });
    } catch (e) {
      console.warn('Error clearing trade levels:', e);
    }
    tradePriceLines = [];
  }

  /**
   * Update chart theme colors dynamically (Light / Dark)
   */
  function updateTheme(theme) {
    if (!chart) return;
    const isDark = theme === 'dark';
    chart.applyOptions({
      layout: {
        background: { type: 'solid', color: isDark ? '#0d121f' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#334155',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9' },
        horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9' },
      },
      crosshair: {
        vertLine: {
          labelBackgroundColor: isDark ? '#1e293b' : '#0f172a',
        },
        horzLine: {
          labelBackgroundColor: isDark ? '#1e293b' : '#0f172a',
        },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
      },
      timeScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
      },
    });
  }

  /**
   * Reset & fit chart view to container
   */
  function fitToView() {
    if (chart) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
  }

  return {
    init,
    setData,
    updateCandle,
    setVolume,
    setOverlay,
    removeOverlay,
    clearOverlays,
    setPatternMarkers,
    setTradeLevels,
    clearTradeLevels,
    setTimeframe,
    updateTheme,
    fitToView,
    getChart: () => chart,
  };
})();

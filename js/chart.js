/* ============================================================
   K-Delta — Chart Wrapper
   Wraps TradingView Lightweight Charts library
   ============================================================ */

const ChartManager = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let overlayLines = {};
  let markers = [];

  const OVERLAY_COLORS = {
    sma20: { color: '#ffd740', title: 'SMA 20' },
    sma50: { color: '#ff6d00', title: 'SMA 50' },
    ema12: { color: '#00e5ff', title: 'EMA 12' },
    ema26: { color: '#d500f9', title: 'EMA 26' },
    bbUpper: { color: 'rgba(0, 212, 255, 0.3)', title: 'BB Upper' },
    bbLower: { color: 'rgba(0, 212, 255, 0.3)', title: 'BB Lower' },
  };

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
        fontFamily: "'Inter', sans-serif",
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
        timeVisible: true,
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
   * Set candlestick data
   * @param {Array} candles - Array of {time, open, high, low, close}
   */
  function setData(candles) {
    if (!candleSeries || !candles.length) return;

    // Convert time strings to proper format
    const formatted = candles.map(c => ({
      time: formatTime(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(formatted);
    chart.timeScale().fitContent();
  }

  /**
   * Set volume data
   * @param {Array} volumeData - Array of {time, value, color}
   */
  function setVolume(volumeData) {
    if (!volumeSeries) return;

    const formatted = volumeData.map(v => ({
      time: formatTime(v.time),
      value: v.value,
      color: v.color || 'rgba(0, 212, 255, 0.3)',
    }));

    volumeSeries.setData(formatted);
  }

  /**
   * Add or update an overlay line series
   * @param {string} name - Overlay name (e.g., 'sma20')
   * @param {Array} data - Array of {time, value}
   */
  function setOverlay(name, data) {
    if (!chart || !data.length) return;

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

    const formatted = data.map(d => ({
      time: formatTime(d.time),
      value: d.value,
    }));

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
    if (!candleSeries) return;

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
      })
      .sort((a, b) => {
        // Sort by time for Lightweight Charts requirement
        if (a.time < b.time) return -1;
        if (a.time > b.time) return 1;
        return 0;
      });

    // Deduplicate by time (Lightweight Charts requires unique times)
    const uniqueMarkers = [];
    const seenTimes = new Set();
    for (const m of markerData) {
      const key = typeof m.time === 'object' ? `${m.time.year}-${m.time.month}-${m.time.day}` : m.time;
      if (!seenTimes.has(key)) {
        seenTimes.add(key);
        uniqueMarkers.push(m);
      }
    }

    candleSeries.setMarkers(uniqueMarkers);
    markers = uniqueMarkers;
  }

  /**
   * Format time for Lightweight Charts
   * Supports "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS" formats
   */
  function formatTime(timeStr) {
    if (!timeStr) return timeStr;

    // If already a number or business day object, return as-is
    if (typeof timeStr === 'number' || typeof timeStr === 'object') return timeStr;

    // "YYYY-MM-DD" → business day
    if (timeStr.length === 10) {
      const [year, month, day] = timeStr.split('-').map(Number);
      return { year, month, day };
    }

    // "YYYY-MM-DD HH:MM:SS" → UTC timestamp
    const date = new Date(timeStr.replace(' ', 'T') + 'Z');
    return Math.floor(date.getTime() / 1000);
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
      chart.remove();
      chart = null;
      candleSeries = null;
      volumeSeries = null;
      overlayLines = {};
    }
  }

  return {
    init,
    setData,
    setVolume,
    setOverlay,
    removeOverlay,
    clearOverlays,
    setPatternMarkers,
    scrollToLatest,
    getChart,
    destroy,
  };
})();

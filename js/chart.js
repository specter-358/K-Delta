/* ============================================================
   K-Delta — Professional Candlestick Chart Engine
   Wraps TradingView Lightweight Charts with Real-Time Streams,
   Overlays (VWAP, EMA, SMA, BB, S/R, Trendlines) & Pattern Markers
   ============================================================ */

const ChartManager = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let overlayLines = {};
  let tradePriceLines = [];
  let srPriceLines = [];
  let currentCandles = [];
  let isIntraday = false;
  let containerEl = null;

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

  /**
   * Format time for Lightweight Charts
   */
  function formatTime(timeVal) {
    if (timeVal == null) return timeVal;
    if (typeof timeVal === 'number') return Math.floor(timeVal);
    if (typeof timeVal === 'string' && /^\d{9,12}$/.test(timeVal.trim())) {
      return parseInt(timeVal.trim(), 10);
    }
    if (typeof timeVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timeVal.trim())) {
      return timeVal.trim();
    }
    if (typeof timeVal === 'object' && timeVal.year && timeVal.month && timeVal.day) {
      return `${timeVal.year}-${String(timeVal.month).padStart(2, '0')}-${String(timeVal.day).padStart(2, '0')}`;
    }
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000);
    }
    return timeVal;
  }

  /**
   * Initialize Chart in container
   */
  function init(container) {
    if (chart) {
      chart.remove();
      chart = null;
    }

    containerEl = container;
    const bgColor = '#080b11';
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
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#101623',
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#101623',
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

      if (!param || !param.time || !param.seriesPrices || !param.seriesPrices.get(candleSeries)) {
        updateOHLCDisplay(null);
        return;
      }

      const bar = param.seriesPrices.get(candleSeries);
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
    const diff = bar.close - bar.open;
    const pct = bar.open ? (diff / bar.open) * 100 : 0;
    const sign = diff >= 0 ? '+' : '';

    ohlcEl.innerHTML = `
      <span style="color:var(--text-muted)">O:</span> <strong>₹${bar.open.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">H:</span> <strong>₹${bar.high.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">L:</span> <strong>₹${bar.low.toFixed(2)}</strong>
      <span style="color:var(--text-muted);margin-left:8px">C:</span> <strong class="${colorClass}">₹${bar.close.toFixed(2)}</strong>
      <span class="${colorClass}" style="margin-left:8px font-weight:700">(${sign}${pct.toFixed(2)}%)</span>
    `;
  }

  /**
   * Set complete historical candle data
   */
  function setData(candles) {
    if (!chart || !candleSeries || !candles || candles.length === 0) return;

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

    candleSeries.setData(formattedCandles);
    cachedVolumes = formattedVolumes;
    if (volumeSeries) {
      volumeSeries.setData(isVolumeVisible ? formattedVolumes : []);
    }

    // Default time scale visibility
    chart.timeScale().applyOptions({
      timeVisible: isIntraday,
    });

    chart.timeScale().fitContent();
    updateOHLCDisplay(null);
  }

  let isVolumeVisible = true;
  let cachedVolumes = [];

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
    if (!candleSeries || !candle) return;

    const formattedTimeKey = formatTime(candle.time);
    candleSeries.update({
      time: formattedTimeKey,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    if (volumeSeries && candle.volume) {
      volumeSeries.update({
        time: formattedTimeKey,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
      });
    }

    // Update current candles cache
    if (currentCandles.length > 0) {
      const last = currentCandles[currentCandles.length - 1];
      if (last.time === candle.time) {
        last.high = candle.high;
        last.low = candle.low;
        last.close = candle.close;
        last.volume = candle.volume;
      } else {
        currentCandles.push({ ...candle });
      }
    }

    updateOHLCDisplay(candle);
  }

  /**
   * Set Technical Overlay (SMA, EMA, VWAP, BB, S/R, Trendline)
   */
  function setOverlay(name, dataPoints) {
    if (!chart || !dataPoints || !dataPoints.length) return;

    try {
      const config = OVERLAY_CONFIGS[name] || { color: '#38bdf8', lineWidth: 1.5, title: name };
      
      let lineSeries = overlayLines[name];
      if (!lineSeries) {
        lineSeries = chart.addLineSeries({
          color: config.color,
          lineWidth: config.lineWidth || 1.5,
          title: config.title || name,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        });
        overlayLines[name] = lineSeries;
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
        lineSeries.setData(formattedData);
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
   * Display Pattern Markers directly on chart candles
   */
  function setPatternMarkers(patternList) {
    if (!candleSeries || !patternList) return;

    // Deduplicate by time and keep highest confidence pattern per bar
    const uniqueByTime = new Map();
    patternList.forEach(p => {
      const timeKey = String(formatTime(p.timestamp));
      if (!uniqueByTime.has(timeKey) || uniqueByTime.get(timeKey).confidence < p.confidence) {
        uniqueByTime.set(timeKey, p);
      }
    });

    const markers = Array.from(uniqueByTime.values()).map(p => {
      const isBullish = p.signal === 'bullish';
      const isBearish = p.signal === 'bearish';

      return {
        time: formatTime(p.timestamp),
        position: isBullish ? 'belowBar' : isBearish ? 'aboveBar' : 'inBar',
        color: isBullish ? '#10b981' : isBearish ? '#f43f5e' : '#f59e0b',
        shape: isBullish ? 'arrowUp' : isBearish ? 'arrowDown' : 'circle',
        text: `${p.name} (${p.confidence}%)`,
        size: 1,
      };
    });

    candleSeries.setMarkers(markers);
  }

  /**
   * Clear Pattern Markers from chart candles
   */
  function clearPatternMarkers() {
    if (!candleSeries) return;
    try {
      candleSeries.setMarkers([]);
    } catch (e) {}
  }

  /**
   * Clear Trade Execution Lines
   */
  function clearTradeLevels() {
    if (!candleSeries || !tradePriceLines.length) return;
    tradePriceLines.forEach(line => {
      try { candleSeries.removePriceLine(line); } catch (e) {}
    });
    tradePriceLines = [];
  }

  /**
   * Set Horizontal Trade Price Lines (Entry, TP1, TP2, SL)
   */
  function setTradeLevels(setup) {
    clearTradeLevels();
    if (!candleSeries) return;

    try {
      let entry = setup && setup.entryPrice;
      let target1 = setup && setup.target1;
      let target2 = setup && setup.target2;
      let stopLoss = setup && setup.stopLoss;
      let isBuy = setup ? (setup.type === 'BUY' || setup.type === 'BUY STOCK' || (setup.signal && setup.signal.includes('BUY'))) : true;

      // Dynamic fallback if no specific pattern setup exists yet
      if (!entry && currentCandles.length > 0) {
        const lastCandle = currentCandles[currentCandles.length - 1];
        entry = lastCandle.close;
        const atr = Indicators.atr(currentCandles, 14);
        const currentAtr = (atr && atr[atr.length - 1]) || (entry * 0.015);
        target1 = +(entry + currentAtr * 1.5).toFixed(2);
        target2 = +(entry + currentAtr * 3.0).toFixed(2);
        stopLoss = +(entry - currentAtr * 1.0).toFixed(2);
      }

      if (entry) {
        tradePriceLines.push(candleSeries.createPriceLine({
          price: entry,
          color: isBuy ? '#10b981' : '#f43f5e',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: isBuy ? 'BUY STOCK' : 'SELL STOCK',
        }));
      }

      if (target1) {
        tradePriceLines.push(candleSeries.createPriceLine({
          price: target1,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TARGET 1 (TP1)',
        }));
      }

      if (target2) {
        tradePriceLines.push(candleSeries.createPriceLine({
          price: target2,
          color: '#059669',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'TARGET 2 (TP2)',
        }));
      }

      if (stopLoss) {
        tradePriceLines.push(candleSeries.createPriceLine({
          price: stopLoss,
          color: '#f43f5e',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'STOP LOSS',
        }));
      }
    } catch (e) {
      console.warn('Error setting trade levels:', e);
    }
  }

  /**
   * Clear Support / Resistance Price Lines
   */
  function clearSupportResistanceLevels() {
    if (!candleSeries || !srPriceLines.length) return;
    srPriceLines.forEach(line => {
      try { candleSeries.removePriceLine(line); } catch (e) {}
    });
    srPriceLines = [];
  }

  /**
   * Set Support / Resistance Price Lines
   */
  function setSupportResistanceLevels(levels) {
    clearSupportResistanceLevels();
    if (!candleSeries || !levels) return;

    try {
      if (levels.support) {
        levels.support.forEach((price, idx) => {
          srPriceLines.push(candleSeries.createPriceLine({
            price,
            color: 'rgba(16, 185, 129, 0.75)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: `S${idx + 1} Support`,
          }));
        });
      }

      if (levels.resistance) {
        levels.resistance.forEach((price, idx) => {
          srPriceLines.push(candleSeries.createPriceLine({
            price,
            color: 'rgba(244, 63, 94, 0.75)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: `R${idx + 1} Resist`,
          }));
        });
      }
    } catch (e) {
      console.warn('Error setting SR levels:', e);
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

  function destroy() {
    if (chart) {
      try {
        chart.remove();
      } catch (e) {}
      chart = null;
    }
    candleSeries = null;
    volumeSeries = null;
    overlayLines = {};
    tradePriceLines = [];
    srPriceLines = [];
    currentCandles = [];
  }

  return {
    init,
    setData,
    updateLiveCandle,
    setOverlay,
    removeOverlay,
    clearAllOverlays,
    setPatternMarkers,
    clearPatternMarkers,
    setVolumeVisibility,
    setTradeLevels,
    clearTradeLevels,
    setSupportResistanceLevels,
    clearSupportResistanceLevels,
    takeScreenshot,
    updateTheme,
    handleResize,
    destroy,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChartManager;
}

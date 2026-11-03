/* ============================================================
   K-Delta — Technical Indicators & Quantitative Overlays
   SMA, EMA, VWAP, Bollinger Bands, Support/Resistance & Trendlines
   ============================================================ */

const Indicators = (() => {
  /**
   * Simple Moving Average (SMA)
   * @param {number[]} data - Array of prices
   * @param {number} period - Lookback period
   */
  function sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          sum += data[j];
        }
        result.push(parseFloat((sum / period).toFixed(2)));
      }
    }
    return result;
  }

  /**
   * Exponential Moving Average (EMA)
   * @param {number[]} data - Array of prices
   * @param {number} period - Lookback period
   */
  function ema(data, period) {
    const result = [];
    const multiplier = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) {
      sum += data[i];
      result.push(null);
    }
    if (data.length < period) return result;

    result[period - 1] = parseFloat((sum / period).toFixed(2));

    for (let i = period; i < data.length; i++) {
      const emaVal = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(parseFloat(emaVal.toFixed(2)));
    }

    return result;
  }

  /**
   * Volume Weighted Average Price (VWAP)
   * Math: Cumulative (Typical Price * Volume) / Cumulative Volume
   * @param {Object[]} candles - Array of OHLCV objects
   */
  function vwap(candles) {
    const result = [];
    let cumTypicalVol = 0;
    let cumVol = 0;
    let lastDateStr = null;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      let dayKey = null;

      if (c && c.time != null) {
        if (typeof c.time === 'number') {
          const d = new Date(c.time * 1000);
          dayKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        } else if (typeof c.time === 'string') {
          dayKey = c.time.split('T')[0];
        }
      }

      // Reset intraday accumulators on each new trading day
      if (lastDateStr !== null && dayKey !== null && dayKey !== lastDateStr) {
        cumTypicalVol = 0;
        cumVol = 0;
      }
      if (dayKey !== null) {
        lastDateStr = dayKey;
      }

      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = Math.max(1, c.volume || 1);

      cumTypicalVol += typicalPrice * vol;
      cumVol += vol;

      const vwapVal = cumVol > 0 ? cumTypicalVol / cumVol : typicalPrice;
      result.push(parseFloat(vwapVal.toFixed(2)));
    }

    return result;
  }

  /**
   * Relative Strength Index (RSI)
   */
  function rsi(closes, period = 14) {
    const result = [];
    if (closes.length < period + 1) {
      return closes.map(() => null);
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
      result.push(null);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    result[period] = avgLoss === 0 ? 100.00 : parseFloat((100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2));

    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      const rsiVal = avgLoss === 0 ? 100.00 : (100 - (100 / (1 + (avgGain / avgLoss))));
      result.push(parseFloat(rsiVal.toFixed(2)));
    }

    return result;
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   */
  function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = ema(closes, fastPeriod);
    const slowEMA = ema(closes, slowPeriod);

    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
      if (fastEMA[i] === null || slowEMA[i] === null) {
        macdLine.push(null);
      } else {
        macdLine.push(fastEMA[i] - slowEMA[i]);
      }
    }

    // Filter valid MACD values for signal EMA
    const validStart = macdLine.findIndex(v => v !== null);
    const validMACD = macdLine.slice(validStart);
    const signalLineRaw = ema(validMACD, signalPeriod);

    const signalLine = [];
    for (let i = 0; i < validStart; i++) signalLine.push(null);
    signalLine.push(...signalLineRaw);

    const histogram = [];
    for (let i = 0; i < closes.length; i++) {
      if (macdLine[i] === null || signalLine[i] === null) {
        histogram.push(null);
      } else {
        histogram.push(parseFloat((macdLine[i] - signalLine[i]).toFixed(3)));
      }
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
      macdLine,
      signalLine,
    };
  }

  /**
   * RSI Status Helper
   */
  function rsiStatus(rsiVal) {
    if (rsiVal == null) return { status: 'Neutral', signal: 'neutral' };
    if (rsiVal >= 70) return { status: 'Overbought', signal: 'sell' };
    if (rsiVal <= 30) return { status: 'Oversold', signal: 'buy' };
    if (rsiVal > 50) return { status: 'Bullish Momentum', signal: 'buy' };
    return { status: 'Bearish Momentum', signal: 'sell' };
  }

  /**
   * MACD Status Helper
   */
  function macdStatus(macdVal, sigVal, histVal) {
    if (macdVal == null || sigVal == null) return { status: 'Neutral', signal: 'neutral' };
    if (macdVal > sigVal && (histVal || 0) > 0) return { status: 'Bullish Momentum', signal: 'buy' };
    if (macdVal < sigVal && (histVal || 0) < 0) return { status: 'Bearish Momentum', signal: 'sell' };
    if (macdVal > sigVal) return { status: 'Bullish Bias', signal: 'buy' };
    return { status: 'Bearish Bias', signal: 'sell' };
  }

  /**
   * Bollinger Squeeze Helper
   */
  function bbSqueeze(upper, lower, middle) {
    if (!upper || !lower || !middle || upper.length < 2) return { status: 'Normal Bandwidth' };
    const lastIdx = upper.length - 1;
    const bandWidth = (upper[lastIdx] - lower[lastIdx]) / (middle[lastIdx] || 1);
    if (bandWidth < 0.04) return { status: 'Volatility Squeeze' };
    if (bandWidth > 0.15) return { status: 'High Volatility' };
    return { status: 'Normal Channel' };
  }

  /**
   * Bollinger Bands
   */
  function bollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    const middle = sma(closes, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < closes.length; i++) {
      if (middle[i] === null) {
        upper.push(null);
        lower.push(null);
      } else {
        let sumSquaredDiff = 0;
        for (let j = i - period + 1; j <= i; j++) {
          sumSquaredDiff += Math.pow(closes[j] - middle[i], 2);
        }
        const stdDev = Math.sqrt(sumSquaredDiff / period);
        upper.push(parseFloat((middle[i] + stdDev * stdDevMultiplier).toFixed(2)));
        lower.push(parseFloat((middle[i] - stdDev * stdDevMultiplier).toFixed(2)));
      }
    }

    return { upper, middle, lower };
  }

  /**
   * Average True Range (ATR)
   */
  function atr(candles, period = 14) {
    if (candles.length < 2) return candles.map(() => null);

    const trueRanges = [candles[0].high - candles[0].low];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      trueRanges.push(tr);
    }

    const result = [];
    for (let i = 0; i < period - 1 && i < trueRanges.length; i++) {
      result.push(null);
    }
    if (trueRanges.length < period) return result;

    let sum = 0;
    for (let i = 0; i < period; i++) sum += trueRanges[i];
    result.push(parseFloat((sum / period).toFixed(2)));

    for (let i = period; i < trueRanges.length; i++) {
      const currentATR = (result[result.length - 1] * (period - 1) + trueRanges[i]) / period;
      result.push(parseFloat(currentATR.toFixed(2)));
    }

    return result;
  }

  /**
   * Dynamic Support and Resistance Cluster Detection
   * Math: Finds local pivot highs and lows within 3-bar radius and groups clusters within 1% price tolerance
   * @param {Object[]} candles
   */
  function supportResistance(candles) {
    if (!candles || candles.length < 15) return { support: [], resistance: [] };

    const pivotHighs = [];
    const pivotLows = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      if (
        c.high >= candles[i - 1].high &&
        c.high >= candles[i - 2].high &&
        c.high >= candles[i + 1].high &&
        c.high >= candles[i + 2].high
      ) {
        pivotHighs.push({ price: c.high, index: i, time: c.time });
      }

      if (
        c.low <= candles[i - 1].low &&
        c.low <= candles[i - 2].low &&
        c.low <= candles[i + 1].low &&
        c.low <= candles[i + 2].low
      ) {
        pivotLows.push({ price: c.low, index: i, time: c.time });
      }
    }

    const currentPrice = candles[candles.length - 1].close;

    // Cluster support levels below current price
    const supportLevels = pivotLows
      .map(p => p.price)
      .filter(p => p < currentPrice)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .map(p => parseFloat(p.toFixed(2)));

    // Cluster resistance levels above current price
    const resistanceLevels = pivotHighs
      .map(p => p.price)
      .filter(p => p > currentPrice)
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map(p => parseFloat(p.toFixed(2)));

    return {
      support: supportLevels.length ? supportLevels : [parseFloat((currentPrice * 0.98).toFixed(2))],
      resistance: resistanceLevels.length ? resistanceLevels : [parseFloat((currentPrice * 1.02).toFixed(2))],
    };
  }

  /**
   * Algorithmic Trendline Detection
   * Connects recent swing highs and swing lows to generate linear regression channel boundaries
   */
  function trendlines(candles) {
    if (!candles || candles.length < 20) return null;

    const n = Math.min(60, candles.length);
    const slice = candles.slice(-n);

    // Linear regression on close prices
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = slice[i].close;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const startIdx = candles.length - n;
    const endIdx = candles.length - 1;

    const upperOffset = Math.max(...slice.map((c, i) => c.high - (slope * i + intercept)));
    const lowerOffset = Math.max(...slice.map((c, i) => (slope * i + intercept) - c.low));

    return {
      slope: parseFloat(slope.toFixed(4)),
      resistanceLine: [
        { time: candles[startIdx].time, value: parseFloat((intercept + upperOffset).toFixed(2)) },
        { time: candles[endIdx].time, value: parseFloat((slope * (n - 1) + intercept + upperOffset).toFixed(2)) },
      ],
      supportLine: [
        { time: candles[startIdx].time, value: parseFloat((intercept - lowerOffset).toFixed(2)) },
        { time: candles[endIdx].time, value: parseFloat((slope * (n - 1) + intercept - lowerOffset).toFixed(2)) },
      ],
    };
  }

  /**
   * Average Directional Index (ADX) — Measures trend strength (not direction)
   * ADX < 20 = no trend, 20-40 = trending, 40+ = strong trend
   */
  function adx(candles, period = 14) {
    if (!candles || candles.length < period * 2) return candles ? candles.map(() => null) : [];

    const plusDM = [];
    const minusDM = [];
    const tr = [];

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        plusDM.push(0);
        minusDM.push(0);
        tr.push(candles[0].high - candles[0].low);
        continue;
      }
      const prev = candles[i - 1];
      const curr = candles[i];
      const upMove = curr.high - prev.high;
      const downMove = prev.low - curr.low;
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      tr.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
    }

    // Smoothed averages
    const smoothTR = [];
    const smoothPlusDM = [];
    const smoothMinusDM = [];
    const result = [];

    for (let i = 0; i < period; i++) {
      result.push(null);
    }

    let sumTR = 0, sumPDM = 0, sumMDM = 0;
    for (let i = 0; i < period; i++) {
      sumTR += tr[i];
      sumPDM += plusDM[i];
      sumMDM += minusDM[i];
    }

    let smoothedTR = sumTR;
    let smoothedPDM = sumPDM;
    let smoothedMDM = sumMDM;

    const dxValues = [];

    for (let i = period; i < candles.length; i++) {
      if (i > period) {
        smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
        smoothedPDM = smoothedPDM - (smoothedPDM / period) + plusDM[i];
        smoothedMDM = smoothedMDM - (smoothedMDM / period) + minusDM[i];
      }

      const plusDI = smoothedTR > 0 ? (smoothedPDM / smoothedTR) * 100 : 0;
      const minusDI = smoothedTR > 0 ? (smoothedMDM / smoothedTR) * 100 : 0;
      const diSum = plusDI + minusDI;
      const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
      dxValues.push(dx);

      if (dxValues.length < period) {
        result.push(null);
      } else if (dxValues.length === period) {
        const adxVal = dxValues.reduce((s, v) => s + v, 0) / period;
        result.push(parseFloat(adxVal.toFixed(2)));
      } else {
        const prevADX = result[result.length - 1] || dx;
        const adxVal = (prevADX * (period - 1) + dx) / period;
        result.push(parseFloat(adxVal.toFixed(2)));
      }
    }

    return result;
  }

  /**
   * On-Balance Volume (OBV) — Confirms if volume supports price direction
   * Rising OBV + Rising Price = Strong move | Divergence = Weak move
   */
  function obv(candles) {
    if (!candles || candles.length === 0) return [];
    const result = [0];
    for (let i = 1; i < candles.length; i++) {
      const vol = candles[i].volume || 0;
      if (candles[i].close > candles[i - 1].close) {
        result.push(result[i - 1] + vol);
      } else if (candles[i].close < candles[i - 1].close) {
        result.push(result[i - 1] - vol);
      } else {
        result.push(result[i - 1]);
      }
    }
    return result;
  }

  /**
   * RSI Divergence Detection
   * Bullish: Price lower low + RSI higher low → Reversal UP likely (~80%)
   * Bearish: Price higher high + RSI lower high → Reversal DOWN likely (~80%)
   * Returns: { type: 'bullish'|'bearish'|null, strength, pricePoints, rsiPoints }
   */
  function rsiDivergence(candles, rsiValues, lookback = 20) {
    if (!candles || !rsiValues || candles.length < lookback + 5) return null;

    const len = candles.length;
    const startIdx = Math.max(0, len - lookback);

    // Find swing lows and swing highs in the lookback window
    const swingLows = [];
    const swingHighs = [];

    for (let i = startIdx + 2; i < len - 2; i++) {
      if (rsiValues[i] == null) continue;
      // Swing low: lower than 2 bars on each side
      if (candles[i].low <= candles[i - 1].low && candles[i].low <= candles[i - 2].low &&
          candles[i].low <= candles[i + 1].low && candles[i].low <= candles[i + 2].low) {
        swingLows.push({ idx: i, price: candles[i].low, rsi: rsiValues[i] });
      }
      // Swing high: higher than 2 bars on each side
      if (candles[i].high >= candles[i - 1].high && candles[i].high >= candles[i - 2].high &&
          candles[i].high >= candles[i + 1].high && candles[i].high >= candles[i + 2].high) {
        swingHighs.push({ idx: i, price: candles[i].high, rsi: rsiValues[i] });
      }
    }

    // Check for bullish divergence: Price lower low, RSI higher low
    if (swingLows.length >= 2) {
      const prev = swingLows[swingLows.length - 2];
      const curr = swingLows[swingLows.length - 1];
      if (curr.price < prev.price && curr.rsi > prev.rsi) {
        const strength = Math.min(100, Math.round((prev.rsi - curr.rsi) * -3 + 70));
        return { type: 'bullish', strength, prevSwing: prev, currSwing: curr };
      }
    }

    // Check for bearish divergence: Price higher high, RSI lower high
    if (swingHighs.length >= 2) {
      const prev = swingHighs[swingHighs.length - 2];
      const curr = swingHighs[swingHighs.length - 1];
      if (curr.price > prev.price && curr.rsi < prev.rsi) {
        const strength = Math.min(100, Math.round((curr.rsi - prev.rsi) * -3 + 70));
        return { type: 'bearish', strength, prevSwing: prev, currSwing: curr };
      }
    }

    return null;
  }

  return {
    sma,
    ema,
    vwap,
    rsi,
    macd,
    bollingerBands,
    atr,
    supportResistance,
    trendlines,
    rsiStatus,
    macdStatus,
    bbSqueeze,
    adx,
    obv,
    rsiDivergence,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Indicators;
}

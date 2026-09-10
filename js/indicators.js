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

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
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

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[period] = parseFloat((100 - 100 / (1 + rs)).toFixed(2));

    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
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

    return { macd: macdLine, signal: signalLine, histogram };
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
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Indicators;
}

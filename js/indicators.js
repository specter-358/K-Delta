/* ============================================================
   K-Delta — Technical Indicators
   Pure JavaScript implementations
   ============================================================ */

const Indicators = (() => {
  /**
   * Simple Moving Average (SMA)
   * @param {number[]} data - Array of close prices
   * @param {number} period - Lookback period
   * @returns {(number|null)[]} Array of SMA values (null where insufficient data)
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
        result.push(sum / period);
      }
    }
    return result;
  }

  /**
   * Exponential Moving Average (EMA)
   * @param {number[]} data - Array of close prices
   * @param {number} period - Lookback period
   * @returns {(number|null)[]} Array of EMA values
   */
  function ema(data, period) {
    const result = [];
    const multiplier = 2 / (period + 1);

    // First EMA value = SMA of first `period` values
    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) {
      sum += data[i];
      result.push(null);
    }
    if (data.length < period) return result;

    result[period - 1] = sum / period;

    for (let i = period; i < data.length; i++) {
      const emaVal = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(emaVal);
    }

    return result;
  }

  /**
   * Relative Strength Index (RSI)
   * @param {number[]} closes - Close prices
   * @param {number} period - Typically 14
   * @returns {(number|null)[]} RSI values (0–100)
   */
  function rsi(closes, period = 14) {
    const result = [];

    if (closes.length < period + 1) {
      return closes.map(() => null);
    }

    // Calculate initial gains and losses
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

    // First RSI
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[period] = 100 - 100 / (1 + rs);

    // Subsequent values (smoothed)
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }

    return result;
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   * @param {number[]} closes - Close prices
   * @param {number} fastPeriod - Fast EMA period (default 12)
   * @param {number} slowPeriod - Slow EMA period (default 26)
   * @param {number} signalPeriod - Signal line period (default 9)
   * @returns {{ macdLine: number[], signalLine: number[], histogram: number[] }}
   */
  function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEma = ema(closes, fastPeriod);
    const slowEma = ema(closes, slowPeriod);

    // MACD line = Fast EMA - Slow EMA
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
      if (fastEma[i] == null || slowEma[i] == null) {
        macdLine.push(null);
      } else {
        macdLine.push(fastEma[i] - slowEma[i]);
      }
    }

    // Signal line = EMA of MACD line
    const validMacd = macdLine.filter(v => v != null);
    const signalEma = ema(validMacd, signalPeriod);

    // Map signal back to full array
    const signalLine = [];
    let signalIdx = 0;
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null) {
        signalLine.push(null);
      } else {
        signalLine.push(signalEma[signalIdx] ?? null);
        signalIdx++;
      }
    }

    // Histogram = MACD - Signal
    const histogram = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null || signalLine[i] == null) {
        histogram.push(null);
      } else {
        histogram.push(macdLine[i] - signalLine[i]);
      }
    }

    return { macdLine, signalLine, histogram };
  }

  /**
   * Bollinger Bands
   * @param {number[]} closes - Close prices
   * @param {number} period - Typically 20
   * @param {number} stdDev - Standard deviation multiplier (default 2)
   * @returns {{ upper: number[], middle: number[], lower: number[] }}
   */
  function bollingerBands(closes, period = 20, stdDev = 2) {
    const middle = sma(closes, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < closes.length; i++) {
      if (middle[i] == null) {
        upper.push(null);
        lower.push(null);
      } else {
        // Calculate standard deviation
        let sumSq = 0;
        for (let j = i - period + 1; j <= i; j++) {
          sumSq += Math.pow(closes[j] - middle[i], 2);
        }
        const sd = Math.sqrt(sumSq / period);
        upper.push(middle[i] + stdDev * sd);
        lower.push(middle[i] - stdDev * sd);
      }
    }

    return { upper, middle, lower };
  }

  /**
   * Average True Range (ATR)
   * @param {Array} candles - Array of {high, low, close}
   * @param {number} period - Typically 14
   * @returns {(number|null)[]}
   */
  function atr(candles, period = 14) {
    if (candles.length < 2) return candles.map(() => null);

    const trueRanges = [candles[0].high - candles[0].low];

    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trueRanges.push(tr);
    }

    return sma(trueRanges, period);
  }

  /**
   * Detect support and resistance levels
   * @param {Array} candles - OHLCV data
   * @param {number} lookback - Number of candles to look back
   * @returns {{ support: number[], resistance: number[] }}
   */
  function supportResistance(candles, lookback = 20) {
    const support = [];
    const resistance = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      let isSupport = true;
      let isResistance = true;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].low < candles[i].low) isSupport = false;
        if (candles[j].high > candles[i].high) isResistance = false;
      }

      if (isSupport) support.push(candles[i].low);
      if (isResistance) resistance.push(candles[i].high);
    }

    return { support, resistance };
  }

  /**
   * Detect moving average crossover events
   * @param {(number|null)[]} fastMA - Fast moving average values
   * @param {(number|null)[]} slowMA - Slow moving average values
   * @returns {{ bullishCross: boolean, bearishCross: boolean, crossIndex: number|null }}
   */
  function maCrossover(fastMA, slowMA) {
    let lastCross = null;
    let crossType = null;

    for (let i = 1; i < fastMA.length; i++) {
      if (fastMA[i] == null || slowMA[i] == null || fastMA[i-1] == null || slowMA[i-1] == null) continue;

      const prevAbove = fastMA[i - 1] > slowMA[i - 1];
      const currAbove = fastMA[i] > slowMA[i];

      if (!prevAbove && currAbove) {
        lastCross = i;
        crossType = 'bullish'; // Golden cross
      } else if (prevAbove && !currAbove) {
        lastCross = i;
        crossType = 'bearish'; // Death cross
      }
    }

    return {
      bullishCross: crossType === 'bullish',
      bearishCross: crossType === 'bearish',
      crossIndex: lastCross,
    };
  }

  /**
   * Get RSI interpretation
   */
  function rsiStatus(value) {
    if (value == null) return { status: 'unknown', signal: 'neutral' };
    if (value >= 70) return { status: 'Overbought', signal: 'bearish' };
    if (value >= 60) return { status: 'Strong', signal: 'neutral' };
    if (value <= 30) return { status: 'Oversold', signal: 'bullish' };
    if (value <= 40) return { status: 'Weak', signal: 'neutral' };
    return { status: 'Neutral', signal: 'neutral' };
  }

  /**
   * Get MACD interpretation
   */
  function macdStatus(macdVal, signalVal, histogram) {
    if (macdVal == null || signalVal == null) return { status: 'unknown', signal: 'neutral' };

    if (histogram > 0 && macdVal > 0) return { status: 'Bullish Momentum', signal: 'bullish' };
    if (histogram > 0 && macdVal <= 0) return { status: 'Bullish Crossover', signal: 'bullish' };
    if (histogram < 0 && macdVal < 0) return { status: 'Bearish Momentum', signal: 'bearish' };
    if (histogram < 0 && macdVal >= 0) return { status: 'Bearish Crossover', signal: 'bearish' };
    return { status: 'Neutral', signal: 'neutral' };
  }

  /**
   * Detect Bollinger Band squeeze
   */
  function bbSqueeze(upper, lower, middle) {
    const lastIdx = upper.length - 1;
    if (upper[lastIdx] == null || lower[lastIdx] == null || middle[lastIdx] == null) {
      return { isSqueeze: false, status: 'Unknown' };
    }

    const bandwidth = (upper[lastIdx] - lower[lastIdx]) / middle[lastIdx];

    // Compare with recent average bandwidth
    let avgBandwidth = 0;
    let count = 0;
    for (let i = Math.max(0, lastIdx - 20); i < lastIdx; i++) {
      if (upper[i] != null && lower[i] != null && middle[i] != null) {
        avgBandwidth += (upper[i] - lower[i]) / middle[i];
        count++;
      }
    }
    avgBandwidth = count > 0 ? avgBandwidth / count : bandwidth;

    if (bandwidth < avgBandwidth * 0.7) {
      return { isSqueeze: true, status: 'Squeeze (Breakout imminent)' };
    }
    if (bandwidth > avgBandwidth * 1.3) {
      return { isSqueeze: false, status: 'Expansion (Trending)' };
    }
    return { isSqueeze: false, status: 'Normal' };
  }

  return {
    sma,
    ema,
    rsi,
    macd,
    bollingerBands,
    atr,
    supportResistance,
    maCrossover,
    rsiStatus,
    macdStatus,
    bbSqueeze,
  };
})();

/* ============================================================
   K-Delta — Candlestick Pattern Detection Engine
   Detects 15+ patterns with explanations
   ============================================================ */

const Patterns = (() => {
  /**
   * Helper: Calculate candle body size
   */
  function bodySize(candle) {
    return Math.abs(candle.close - candle.open);
  }

  /**
   * Helper: Full candle range (high - low)
   */
  function candleRange(candle) {
    return candle.high - candle.low;
  }

  /**
   * Helper: Is the candle bullish?
   */
  function isBullish(candle) {
    return candle.close > candle.open;
  }

  /**
   * Helper: Is the candle bearish?
   */
  function isBearish(candle) {
    return candle.close < candle.open;
  }

  /**
   * Helper: Upper shadow size
   */
  function upperShadow(candle) {
    return candle.high - Math.max(candle.open, candle.close);
  }

  /**
   * Helper: Lower shadow size
   */
  function lowerShadow(candle) {
    return Math.min(candle.open, candle.close) - candle.low;
  }

  /**
   * Helper: Is there a prior downtrend? (last N candles)
   */
  function isPriorDowntrend(candles, index, lookback = 5) {
    if (index < lookback) return false;
    let downCount = 0;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].close < candles[i].open) downCount++;
    }
    return downCount >= Math.ceil(lookback * 0.6);
  }

  /**
   * Helper: Is there a prior uptrend?
   */
  function isPriorUptrend(candles, index, lookback = 5) {
    if (index < lookback) return false;
    let upCount = 0;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].close > candles[i].open) upCount++;
    }
    return upCount >= Math.ceil(lookback * 0.6);
  }

  /**
   * Helper: Average body size of recent candles
   */
  function avgBodySize(candles, endIndex, lookback = 10) {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, endIndex - lookback); i < endIndex; i++) {
      sum += bodySize(candles[i]);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  // ────────────────────────────────────────────
  // SINGLE-CANDLE PATTERNS
  // ────────────────────────────────────────────

  /**
   * Doji — Open ≈ Close
   */
  function detectDoji(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);

    if (range === 0) return null;
    if (body / range > 0.1) return null; // Body must be ≤10% of total range

    return {
      name: 'Doji',
      type: 'reversal',
      signal: 'neutral',
      confidence: 'medium',
      index,
      explanation:
        'A Doji candle forms when the opening and closing prices are nearly equal, creating a cross-like shape. This signals market indecision — neither buyers nor sellers have gained control. Often appears at the end of trends and can signal a potential reversal. Watch the next few candles for confirmation.',
    };
  }

  /**
   * Hammer — Small body at top, long lower shadow (bullish reversal)
   */
  function detectHammer(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const lower = lowerShadow(c);
    const upper = upperShadow(c);

    if (range === 0) return null;
    if (lower < body * 2) return null; // Lower shadow ≥ 2x body
    if (upper > body * 0.5) return null; // Little to no upper shadow
    if (!isPriorDowntrend(candles, index)) return null;

    return {
      name: 'Hammer',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'high',
      index,
      explanation:
        'A Hammer pattern appears after a downtrend. The long lower shadow shows that sellers pushed prices down significantly during the session, but buyers stepped in and pushed the price back up near the open. This rejection of lower prices suggests selling pressure is exhausting and a bullish reversal may follow.',
    };
  }

  /**
   * Inverted Hammer — Small body at bottom, long upper shadow (bullish reversal)
   */
  function detectInvertedHammer(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const lower = lowerShadow(c);
    const upper = upperShadow(c);

    if (range === 0) return null;
    if (upper < body * 2) return null;
    if (lower > body * 0.5) return null;
    if (!isPriorDowntrend(candles, index)) return null;

    return {
      name: 'Inverted Hammer',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'medium',
      index,
      explanation:
        'An Inverted Hammer appears after a downtrend with a long upper shadow. It shows buyers attempted to push prices higher during the session. While sellers brought it back down, the buying interest signals potential bullish reversal — especially if confirmed by a strong bullish candle next.',
    };
  }

  /**
   * Hanging Man — Like hammer but after an uptrend (bearish reversal)
   */
  function detectHangingMan(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const lower = lowerShadow(c);
    const upper = upperShadow(c);

    if (range === 0) return null;
    if (lower < body * 2) return null;
    if (upper > body * 0.5) return null;
    if (!isPriorUptrend(candles, index)) return null;

    return {
      name: 'Hanging Man',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'high',
      index,
      explanation:
        'A Hanging Man appears at the top of an uptrend and looks like a Hammer. The long lower shadow indicates that selling pressure is increasing — sellers were able to push prices down significantly during the session. This warns that the uptrend may be losing strength and a bearish reversal could follow.',
    };
  }

  /**
   * Shooting Star — Long upper shadow after uptrend (bearish reversal)
   */
  function detectShootingStar(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const lower = lowerShadow(c);
    const upper = upperShadow(c);

    if (range === 0) return null;
    if (upper < body * 2) return null;
    if (lower > body * 0.5) return null;
    if (!isPriorUptrend(candles, index)) return null;

    return {
      name: 'Shooting Star',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'high',
      index,
      explanation:
        'A Shooting Star appears after an uptrend with a long upper shadow. Buyers pushed the price to new highs during the session, but sellers fought back and drove it down near the open. This rejection of higher prices signals that bullish momentum is fading and a bearish reversal is likely.',
    };
  }

  // ────────────────────────────────────────────
  // TWO-CANDLE PATTERNS
  // ────────────────────────────────────────────

  /**
   * Bullish Engulfing — Large bullish candle engulfs previous bearish candle
   */
  function detectBullishEngulfing(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBearish(prev) || !isBullish(curr)) return null;
    if (curr.open > prev.close || curr.close < prev.open) return null;
    if (bodySize(curr) <= bodySize(prev)) return null;
    if (!isPriorDowntrend(candles, index - 1)) return null;

    return {
      name: 'Bullish Engulfing',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'high',
      index,
      explanation:
        'A Bullish Engulfing pattern occurs when a large green (bullish) candle completely engulfs the previous red (bearish) candle after a downtrend. This demonstrates a dramatic shift in momentum — buyers have overwhelmed sellers. The larger the engulfing candle, the stronger the reversal signal.',
    };
  }

  /**
   * Bearish Engulfing — Large bearish candle engulfs previous bullish candle
   */
  function detectBearishEngulfing(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBullish(prev) || !isBearish(curr)) return null;
    if (curr.open < prev.close || curr.close > prev.open) return null;
    if (bodySize(curr) <= bodySize(prev)) return null;
    if (!isPriorUptrend(candles, index - 1)) return null;

    return {
      name: 'Bearish Engulfing',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'high',
      index,
      explanation:
        'A Bearish Engulfing pattern occurs when a large red (bearish) candle completely engulfs the previous green (bullish) candle after an uptrend. Sellers have taken decisive control, overwhelming buying pressure. This is one of the most reliable bearish reversal signals.',
    };
  }

  /**
   * Piercing Line — Bullish reversal: bearish candle followed by bullish candle that closes above midpoint
   */
  function detectPiercingLine(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBearish(prev) || !isBullish(curr)) return null;
    const prevMid = (prev.open + prev.close) / 2;
    if (curr.open > prev.close) return null; // Must gap down or open at/below prev close
    if (curr.close < prevMid) return null; // Must close above midpoint
    if (curr.close > prev.open) return null; // Must not fully engulf
    if (!isPriorDowntrend(candles, index - 1)) return null;

    return {
      name: 'Piercing Line',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'medium',
      index,
      explanation:
        'A Piercing Line forms after a downtrend when a bullish candle opens below the previous bearish candle\'s close and rallies to close above its midpoint. This shows buyers are regaining control and "piercing" through the selling pressure. Stronger when accompanied by high volume.',
    };
  }

  /**
   * Dark Cloud Cover — Bearish reversal: bullish candle followed by bearish candle
   */
  function detectDarkCloudCover(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBullish(prev) || !isBearish(curr)) return null;
    const prevMid = (prev.open + prev.close) / 2;
    if (curr.open < prev.close) return null; // Must gap up or open at/above prev close
    if (curr.close > prevMid) return null; // Must close below midpoint
    if (curr.close < prev.open) return null; // Must not fully engulf
    if (!isPriorUptrend(candles, index - 1)) return null;

    return {
      name: 'Dark Cloud Cover',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'medium',
      index,
      explanation:
        'A Dark Cloud Cover forms after an uptrend when a bearish candle opens above the previous bullish candle\'s close and drops to close below its midpoint. It\'s like a dark cloud moving over the bulls\' sunny outlook — the bears are taking control. Watch for follow-through selling.',
    };
  }

  /**
   * Tweezer Top — Two candles with same high after uptrend
   */
  function detectTweezerTop(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    const tolerance = candleRange(curr) * 0.02;
    if (Math.abs(prev.high - curr.high) > tolerance) return null;
    if (!isBullish(prev) || !isBearish(curr)) return null;
    if (!isPriorUptrend(candles, index - 1)) return null;

    return {
      name: 'Tweezer Top',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'medium',
      index,
      explanation:
        'Tweezer Tops form when two consecutive candles have nearly identical highs after an uptrend. The first is bullish and the second is bearish. The matching highs represent a resistance level the price cannot break through, suggesting selling pressure is capping further gains.',
    };
  }

  /**
   * Tweezer Bottom — Two candles with same low after downtrend
   */
  function detectTweezerBottom(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    const tolerance = candleRange(curr) * 0.02;
    if (Math.abs(prev.low - curr.low) > tolerance) return null;
    if (!isBearish(prev) || !isBullish(curr)) return null;
    if (!isPriorDowntrend(candles, index - 1)) return null;

    return {
      name: 'Tweezer Bottom',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'medium',
      index,
      explanation:
        'Tweezer Bottoms form when two consecutive candles have nearly identical lows after a downtrend. The matching lows establish a support level — buyers defend this price twice. The second bullish candle confirms buyers are stepping in.',
    };
  }

  // ────────────────────────────────────────────
  // THREE-CANDLE PATTERNS
  // ────────────────────────────────────────────

  /**
   * Morning Star — Three-candle bullish reversal
   */
  function detectMorningStar(candles, index) {
    if (index < 2) return null;
    const first = candles[index - 2];
    const second = candles[index - 1];
    const third = candles[index];

    if (!isBearish(first)) return null;
    if (bodySize(second) > bodySize(first) * 0.5) return null; // Small body (star)
    if (!isBullish(third)) return null;
    if (third.close < (first.open + first.close) / 2) return null; // Must close above midpoint
    if (!isPriorDowntrend(candles, index - 2)) return null;

    return {
      name: 'Morning Star',
      type: 'bullish_reversal',
      signal: 'bullish',
      confidence: 'high',
      index,
      explanation:
        'A Morning Star is a powerful three-candle reversal pattern. First, a large bearish candle shows strong selling. Then, a small-bodied "star" candle shows indecision — selling pressure is exhausting. Finally, a large bullish candle confirms buyers have taken control. This is one of the most reliable bullish reversal patterns.',
    };
  }

  /**
   * Evening Star — Three-candle bearish reversal
   */
  function detectEveningStar(candles, index) {
    if (index < 2) return null;
    const first = candles[index - 2];
    const second = candles[index - 1];
    const third = candles[index];

    if (!isBullish(first)) return null;
    if (bodySize(second) > bodySize(first) * 0.5) return null;
    if (!isBearish(third)) return null;
    if (third.close > (first.open + first.close) / 2) return null;
    if (!isPriorUptrend(candles, index - 2)) return null;

    return {
      name: 'Evening Star',
      type: 'bearish_reversal',
      signal: 'bearish',
      confidence: 'high',
      index,
      explanation:
        'An Evening Star is a powerful three-candle bearish reversal. After a large bullish candle, a small "star" candle signals indecision at the top. The subsequent large bearish candle confirms sellers have taken over. Like the evening star heralding nightfall, this pattern warns that the bullish trend is ending.',
    };
  }

  /**
   * Three White Soldiers — Three consecutive large bullish candles
   */
  function detectThreeWhiteSoldiers(candles, index) {
    if (index < 2) return null;
    const first = candles[index - 2];
    const second = candles[index - 1];
    const third = candles[index];

    if (!isBullish(first) || !isBullish(second) || !isBullish(third)) return null;

    // Each should close progressively higher
    if (second.close <= first.close || third.close <= second.close) return null;

    // Each should open within the body of the previous candle
    if (second.open < first.open || second.open > first.close) return null;
    if (third.open < second.open || third.open > second.close) return null;

    // Bodies should be reasonably sized
    const avg = avgBodySize(candles, index - 2);
    if (bodySize(first) < avg * 0.5 || bodySize(second) < avg * 0.5 || bodySize(third) < avg * 0.5) return null;

    return {
      name: 'Three White Soldiers',
      type: 'bullish_continuation',
      signal: 'bullish',
      confidence: 'high',
      index,
      explanation:
        'Three White Soldiers consists of three consecutive long bullish candles, each opening within the prior candle\'s body and closing progressively higher. This pattern represents sustained buying pressure and strong bullish momentum. It often signals the start of a significant uptrend.',
    };
  }

  /**
   * Three Black Crows — Three consecutive large bearish candles
   */
  function detectThreeBlackCrows(candles, index) {
    if (index < 2) return null;
    const first = candles[index - 2];
    const second = candles[index - 1];
    const third = candles[index];

    if (!isBearish(first) || !isBearish(second) || !isBearish(third)) return null;

    if (second.close >= first.close || third.close >= second.close) return null;

    if (second.open > first.open || second.open < first.close) return null;
    if (third.open > second.open || third.open < second.close) return null;

    const avg = avgBodySize(candles, index - 2);
    if (bodySize(first) < avg * 0.5 || bodySize(second) < avg * 0.5 || bodySize(third) < avg * 0.5) return null;

    return {
      name: 'Three Black Crows',
      type: 'bearish_continuation',
      signal: 'bearish',
      confidence: 'high',
      index,
      explanation:
        'Three Black Crows consists of three consecutive long bearish candles, each opening within the prior candle\'s body and closing progressively lower. This represents relentless selling pressure. Like crows circling, this pattern warns of continued downside — sellers are in full control.',
    };
  }

  // ────────────────────────────────────────────
  // MAIN DETECTION ENGINE
  // ────────────────────────────────────────────

  /**
   * Detect all patterns in the candle data
   * Only checks the most recent `lookback` candles
   * @param {Array} candles - OHLCV data
   * @param {number} lookback - How many recent candles to scan
   * @returns {Array} Detected patterns sorted by index (most recent first)
   */
  function detectAll(candles, lookback = 20) {
    const patterns = [];
    const startIdx = Math.max(0, candles.length - lookback);

    const detectors = [
      detectDoji,
      detectHammer,
      detectInvertedHammer,
      detectHangingMan,
      detectShootingStar,
      detectBullishEngulfing,
      detectBearishEngulfing,
      detectPiercingLine,
      detectDarkCloudCover,
      detectTweezerTop,
      detectTweezerBottom,
      detectMorningStar,
      detectEveningStar,
      detectThreeWhiteSoldiers,
      detectThreeBlackCrows,
    ];

    for (let i = startIdx; i < candles.length; i++) {
      for (const detector of detectors) {
        const pattern = detector(candles, i);
        if (pattern) {
          patterns.push(pattern);
        }
      }
    }

    // Sort by index descending (most recent first), then by confidence
    const confidenceOrder = { high: 0, medium: 1, low: 2 };
    patterns.sort((a, b) => {
      if (b.index !== a.index) return b.index - a.index;
      return (confidenceOrder[a.confidence] || 2) - (confidenceOrder[b.confidence] || 2);
    });

    return patterns;
  }

  return {
    detectAll,
    // Export individual detectors for testing
    detectDoji,
    detectHammer,
    detectInvertedHammer,
    detectHangingMan,
    detectShootingStar,
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectPiercingLine,
    detectDarkCloudCover,
    detectTweezerTop,
    detectTweezerBottom,
    detectMorningStar,
    detectEveningStar,
    detectThreeWhiteSoldiers,
    detectThreeBlackCrows,
  };
})();

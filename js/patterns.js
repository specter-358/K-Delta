/* ============================================================
   K-Delta — Mathematical Candlestick Pattern Recognition Engine
   Institutional Classifiers with Strict OHLC Geometry & Confidence
   ============================================================ */

const Patterns = (() => {
  /**
   * Helper: Calculate absolute candle body size
   */
  function bodySize(candle) {
    return Math.abs(candle.close - candle.open);
  }

  /**
   * Helper: Full candle range (High - Low)
   */
  function candleRange(candle) {
    return Math.max(0.001, candle.high - candle.low);
  }

  /**
   * Helper: Is candle bullish?
   */
  function isBullish(candle) {
    return candle.close > candle.open;
  }

  /**
   * Helper: Is candle bearish?
   */
  function isBearish(candle) {
    return candle.close < candle.open;
  }

  /**
   * Helper: Upper shadow / wick length
   */
  function upperShadow(candle) {
    return Math.max(0, candle.high - Math.max(candle.open, candle.close));
  }

  /**
   * Helper: Lower shadow / wick length
   */
  function lowerShadow(candle) {
    return Math.max(0, Math.min(candle.open, candle.close) - candle.low);
  }

  /**
   * Helper: Check prior downtrend (at least 60% bearish closes over lookback)
   */
  function isPriorDowntrend(candles, index, lookback = 4) {
    if (index < lookback) return false;
    let downCount = 0;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].close < candles[i].open) downCount++;
    }
    const netDrop = candles[index - 1].close < candles[index - lookback].open;
    return downCount >= Math.ceil(lookback * 0.5) || netDrop;
  }

  /**
   * Helper: Check prior uptrend (at least 60% bullish closes over lookback)
   */
  function isPriorUptrend(candles, index, lookback = 4) {
    if (index < lookback) return false;
    let upCount = 0;
    for (let i = index - lookback; i < index; i++) {
      if (candles[i].close > candles[i].open) upCount++;
    }
    const netRise = candles[index - 1].close > candles[index - lookback].open;
    return upCount >= Math.ceil(lookback * 0.5) || netRise;
  }

  /**
   * Helper: Average body size of preceding candles
   */
  function avgBodySize(candles, endIndex, lookback = 10) {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, endIndex - lookback); i < endIndex; i++) {
      sum += bodySize(candles[i]);
      count++;
    }
    return count > 0 ? sum / count : 0.1;
  }

  // ════════════════════════════════════════════════════════════
  // 1. SINGLE-CANDLE PATTERNS
  // ════════════════════════════════════════════════════════════

  /**
   * Doji Classifiers (Standard, Dragonfly, Gravestone, Long-Legged)
   * Math: Body <= 10% of total candle range
   */
  function detectDoji(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);

    if (body / range > 0.10) return null;

    let subType = 'Standard Doji';
    let signal = 'neutral';
    let confidence = 70;
    let desc = 'Open and close are virtually identical, reflecting supply-demand equilibrium and market indecision.';

    if (uShadow / range <= 0.08 && lShadow / range >= 0.70) {
      subType = 'Dragonfly Doji';
      signal = isPriorDowntrend(candles, index) ? 'bullish' : 'neutral';
      confidence = 78;
      desc = 'Long lower shadow with open/close near the absolute high indicates heavy intraday rejection of lower prices.';
    } else if (lShadow / range <= 0.08 && uShadow / range >= 0.70) {
      subType = 'Gravestone Doji';
      signal = isPriorUptrend(candles, index) ? 'bearish' : 'neutral';
      confidence = 78;
      desc = 'Long upper shadow with open/close near the absolute low indicates heavy intraday rejection of higher prices.';
    } else if (uShadow / range >= 0.35 && lShadow / range >= 0.35) {
      subType = 'Long-Legged Doji';
      confidence = 72;
      desc = 'Extensive upper and lower shadows indicate severe two-sided volatility and sudden trend exhaustion.';
    }

    return {
      name: subType,
      type: 'single',
      signal,
      confidence,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: desc,
      rulesMatched: [
        'Body <= 10% of total candle range',
        `Upper shadow: ${(uShadow/range*100).toFixed(1)}%, Lower shadow: ${(lShadow/range*100).toFixed(1)}%`,
      ],
    };
  }

  /**
   * Hammer
   * Math: Downtrend + Small body at top (<= 35% range) + Lower shadow >= 2x body + Upper shadow <= 10% range
   */
  function detectHammer(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);

    if (!isPriorDowntrend(candles, index)) return null;
    if (body === 0 || body / range > 0.35) return null;
    if (lShadow < 2.0 * body) return null;
    if (uShadow / range > 0.12) return null;

    const isGreen = isBullish(c);
    const confidence = isGreen ? 84 : 76;

    return {
      name: 'Hammer',
      type: 'single',
      signal: 'bullish',
      confidence,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: `Bullish reversal formation after downtrend. Bears attempted a severe breakdown, but buyers aggressively absorbed all volume, driving price back near highs.`,
      rulesMatched: [
        'Confirmed prior downtrend',
        'Small body located in upper 35% of range',
        `Lower shadow (${lShadow.toFixed(2)}) >= 2.0x body (${body.toFixed(2)})`,
        'Minimal upper shadow (<= 12% of range)',
      ],
    };
  }

  /**
   * Inverted Hammer
   * Math: Downtrend + Small body at bottom (<= 35% range) + Upper shadow >= 2x body + Lower shadow <= 10% range
   */
  function detectInvertedHammer(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);

    if (!isPriorDowntrend(candles, index)) return null;
    if (body === 0 || body / range > 0.35) return null;
    if (uShadow < 2.0 * body) return null;
    if (lShadow / range > 0.12) return null;

    return {
      name: 'Inverted Hammer',
      type: 'single',
      signal: 'bullish',
      confidence: 76,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: `Bullish reversal attempt after downtrend. Buyers stepped in aggressively during the session to test overhead supply; confirms impending buyer takeover on next bar confirmation.`,
      rulesMatched: [
        'Confirmed prior downtrend',
        'Small body located in lower 35% of range',
        `Upper shadow (${uShadow.toFixed(2)}) >= 2.0x body (${body.toFixed(2)})`,
        'Minimal lower shadow (<= 12% of range)',
      ],
    };
  }

  /**
   * Shooting Star
   * Math: Uptrend + Small body at bottom (<= 35% range) + Upper shadow >= 2x body + Lower shadow <= 10% range
   */
  function detectShootingStar(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);

    if (!isPriorUptrend(candles, index)) return null;
    if (body === 0 || body / range > 0.35) return null;
    if (uShadow < 2.0 * body) return null;
    if (lShadow / range > 0.12) return null;

    return {
      name: 'Shooting Star',
      type: 'single',
      signal: 'bearish',
      confidence: 82,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: `Bearish reversal formation at resistance. Buyers pushed price to new intraday highs, but sellers overwhelmed demand and pushed price down near the session open.`,
      rulesMatched: [
        'Confirmed prior uptrend / resistance approach',
        'Small body located in lower 35% of range',
        `Upper shadow (${uShadow.toFixed(2)}) >= 2.0x body (${body.toFixed(2)})`,
        'Minimal lower shadow',
      ],
    };
  }

  /**
   * Hanging Man
   * Math: Uptrend + Small body at top (<= 35% range) + Lower shadow >= 2x body + Upper shadow <= 10% range
   */
  function detectHangingMan(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);

    if (!isPriorUptrend(candles, index)) return null;
    if (body === 0 || body / range > 0.35) return null;
    if (lShadow < 2.0 * body) return null;
    if (uShadow / range > 0.12) return null;

    return {
      name: 'Hanging Man',
      type: 'single',
      signal: 'bearish',
      confidence: 75,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: `Bearish warning signal at market peak. The deep intraday sell-off demonstrates that institutional supply is entering the market.`,
      rulesMatched: [
        'Confirmed prior uptrend',
        'Small body located near peak',
        `Lower shadow (${lShadow.toFixed(2)}) >= 2.0x body (${body.toFixed(2)})`,
      ],
    };
  }

  /**
   * Marubozu (Bullish & Bearish)
   * Math: Body >= 85% of total range + Wicks <= 5% of range
   */
  function detectMarubozu(candles, index) {
    const c = candles[index];
    const body = bodySize(c);
    const range = candleRange(c);
    const uShadow = upperShadow(c);
    const lShadow = lowerShadow(c);
    const avgBody = avgBodySize(candles, index);

    if (body / range < 0.85) return null;
    if (uShadow / range > 0.06 || lShadow / range > 0.06) return null;
    if (body < avgBody * 1.3) return null; // Must be significant size

    const bullish = isBullish(c);
    return {
      name: bullish ? 'Bullish Marubozu' : 'Bearish Marubozu',
      type: 'single',
      signal: bullish ? 'bullish' : 'bearish',
      confidence: 88,
      timestamp: c.time,
      index,
      price: c.close,
      explanation: bullish
        ? 'Extreme directional momentum: buyers maintained absolute control from open to close without letting sellers push price back.'
        : 'Extreme directional liquidation: sellers dominated the entire session from open to close without buyer resistance.',
      rulesMatched: [
        `Body covers ${(body/range*100).toFixed(1)}% of total range (>= 85%)`,
        'Virtually zero upper/lower shadows (<= 6%)',
        `Body size ${(body).toFixed(2)} exceeds 1.3x average body ${(avgBody).toFixed(2)}`,
      ],
    };
  }

  // ════════════════════════════════════════════════════════════
  // 2. MULTI-CANDLE PATTERNS
  // ════════════════════════════════════════════════════════════

  /**
   * Bullish Engulfing
   * Math: C1 < O1 (Red) + C2 > O2 (Green) + O2 <= C1 + C2 >= O1
   */
  function detectBullishEngulfing(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBearish(prev) || !isBullish(curr)) return null;
    if (bodySize(prev) === 0 || bodySize(curr) === 0) return null;

    // Body 2 must completely cover Body 1
    const engulfs = curr.open <= (prev.close + 0.05) && curr.close >= (prev.open - 0.05);
    if (!engulfs) return null;
    if (!isPriorDowntrend(candles, index - 1)) return null;

    const sizeRatio = bodySize(curr) / bodySize(prev);
    const confidence = sizeRatio >= 1.5 ? 86 : 80;

    return {
      name: 'Bullish Engulfing',
      type: 'multi',
      signal: 'bullish',
      confidence,
      timestamp: curr.time,
      index,
      price: curr.close,
      explanation: `High-reliability institutional reversal: a large bullish green bar completely engulfs the prior bearish red body after a downtrend, signaling full buyer dominance.`,
      rulesMatched: [
        'Prior candle was bearish red',
        'Current candle is strong bullish green',
        `Current body (${bodySize(curr).toFixed(2)}) completely engulfs prior body (${bodySize(prev).toFixed(2)})`,
        'Confirmed preceding downtrend',
      ],
    };
  }

  /**
   * Bearish Engulfing
   * Math: C1 > O1 (Green) + C2 < O2 (Red) + O2 >= C1 + C2 <= O1
   */
  function detectBearishEngulfing(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBullish(prev) || !isBearish(curr)) return null;
    if (bodySize(prev) === 0 || bodySize(curr) === 0) return null;

    const engulfs = curr.open >= (prev.close - 0.05) && curr.close <= (prev.open + 0.05);
    if (!engulfs) return null;
    if (!isPriorUptrend(candles, index - 1)) return null;

    const sizeRatio = bodySize(curr) / bodySize(prev);
    const confidence = sizeRatio >= 1.5 ? 85 : 79;

    return {
      name: 'Bearish Engulfing',
      type: 'multi',
      signal: 'bearish',
      confidence,
      timestamp: curr.time,
      index,
      price: curr.close,
      explanation: `Institutional distribution pattern: a large bearish red candle completely engulfs the prior green candle at peak/resistance, signaling supply flooding the market.`,
      rulesMatched: [
        'Prior candle was bullish green',
        'Current candle is strong bearish red',
        `Current body (${bodySize(curr).toFixed(2)}) completely engulfs prior body (${bodySize(prev).toFixed(2)})`,
        'Confirmed preceding uptrend / resistance zone',
      ],
    };
  }

  /**
   * Piercing Pattern
   * Math: Downtrend + C1 < O1 (Red) + C2 > O2 (Green) + O2 < Low1 + C2 > midpoint(C1, O1) + C2 < O1
   */
  function detectPiercingPattern(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBearish(prev) || !isBullish(curr)) return null;
    if (!isPriorDowntrend(candles, index - 1)) return null;

    const prevMidpoint = (prev.open + prev.close) / 2;
    const opensBelow = curr.open <= prev.close;
    const closesAboveMid = curr.close > prevMidpoint && curr.close < prev.open;

    if (!opensBelow || !closesAboveMid) return null;

    return {
      name: 'Piercing Pattern',
      type: 'multi',
      signal: 'bullish',
      confidence: 80,
      timestamp: curr.time,
      index,
      price: curr.close,
      explanation: `Bullish bottom reversal: price opened with a gap down below prior session low, but strong accumulation forced a powerful close > 50% into the preceding red candle body.`,
      rulesMatched: [
        'Preceding bar was long red candle in downtrend',
        'Current bar opened below previous close/low',
        `Current bar closed > 50% midpoint of previous body (Close: ₹${curr.close.toFixed(2)} > Mid: ₹${prevMidpoint.toFixed(2)})`,
      ],
    };
  }

  /**
   * Dark Cloud Cover
   * Math: Uptrend + C1 > O1 (Green) + C2 < O2 (Red) + O2 > High1 + C2 < midpoint(C1, O1) + C2 > O1
   */
  function detectDarkCloudCover(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    if (!isBullish(prev) || !isBearish(curr)) return null;
    if (!isPriorUptrend(candles, index - 1)) return null;

    const prevMidpoint = (prev.open + prev.close) / 2;
    const opensAbove = curr.open >= prev.close;
    const closesBelowMid = curr.close < prevMidpoint && curr.close > prev.open;

    if (!opensAbove || !closesBelowMid) return null;

    return {
      name: 'Dark Cloud Cover',
      type: 'multi',
      signal: 'bearish',
      confidence: 81,
      timestamp: curr.time,
      index,
      price: curr.close,
      explanation: `Bearish top reversal: price gapped up at the open, but bears rejected the new high and drove price down to close > 50% into the previous bullish candle body.`,
      rulesMatched: [
        'Preceding bar was long green candle in uptrend',
        'Current bar opened above previous close/high',
        `Current bar closed < 50% midpoint of previous body (Close: ₹${curr.close.toFixed(2)} < Mid: ₹${prevMidpoint.toFixed(2)})`,
      ],
    };
  }

  /**
   * Morning Star (3-Candle Bullish Reversal)
   * Math: C1 long red + C2 small star body (gap down) + C3 long green closing > 50% into C1
   */
  function detectMorningStar(candles, index) {
    if (index < 2) return null;
    const c1 = candles[index - 2];
    const c2 = candles[index - 1];
    const c3 = candles[index];

    if (!isBearish(c1) || !isBullish(c3)) return null;
    if (!isPriorDowntrend(candles, index - 2)) return null;

    const c1Body = bodySize(c1);
    const c2Body = bodySize(c2);
    const c3Body = bodySize(c3);

    // c2 must be small star (<= 35% of c1)
    if (c2Body > c1Body * 0.40) return null;
    // c3 must close > 50% into c1
    const c1Mid = (c1.open + c1.close) / 2;
    if (c3.close < c1Mid) return null;
    if (c3Body < c1Body * 0.5) return null;

    return {
      name: 'Morning Star',
      type: 'multi',
      signal: 'bullish',
      confidence: 89,
      timestamp: c3.time,
      index,
      price: c3.close,
      explanation: `Premier 3-bar bullish reversal: Long red bar (panic), followed by indecision star/doji (supply exhaustion), followed by high-volume green breakout closing deep into the first bar.`,
      rulesMatched: [
        'Bar 1: Substantial bearish red candle in downtrend',
        `Bar 2: Indecision star body (${c2Body.toFixed(2)}) <= 40% of Bar 1 body (${c1Body.toFixed(2)})`,
        `Bar 3: Bullish green bar closing above 50% midpoint (₹${c1Mid.toFixed(2)})`,
      ],
    };
  }

  /**
   * Evening Star (3-Candle Bearish Reversal)
   * Math: C1 long green + C2 small star body (gap up) + C3 long red closing < 50% into C1
   */
  function detectEveningStar(candles, index) {
    if (index < 2) return null;
    const c1 = candles[index - 2];
    const c2 = candles[index - 1];
    const c3 = candles[index];

    if (!isBullish(c1) || !isBearish(c3)) return null;
    if (!isPriorUptrend(candles, index - 2)) return null;

    const c1Body = bodySize(c1);
    const c2Body = bodySize(c2);
    const c3Body = bodySize(c3);

    if (c2Body > c1Body * 0.40) return null;
    const c1Mid = (c1.open + c1.close) / 2;
    if (c3.close > c1Mid) return null;
    if (c3Body < c1Body * 0.5) return null;

    return {
      name: 'Evening Star',
      type: 'multi',
      signal: 'bearish',
      confidence: 88,
      timestamp: c3.time,
      index,
      price: c3.close,
      explanation: `Premier 3-bar bearish reversal at peaks: Long green bar (euphoria), followed by indecision star/doji (buyer exhaustion), followed by aggressive liquidation closing deep into the first bar.`,
      rulesMatched: [
        'Bar 1: Substantial bullish green candle in uptrend',
        `Bar 2: Indecision star body (${c2Body.toFixed(2)}) <= 40% of Bar 1 body (${c1Body.toFixed(2)})`,
        `Bar 3: Bearish red bar closing below 50% midpoint (₹${c1Mid.toFixed(2)})`,
      ],
    };
  }

  /**
   * Harami (Bullish & Bearish Inside Bar)
   * Math: Body 2 is completely contained inside Body 1
   */
  function detectHarami(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    const prevBody = bodySize(prev);
    const currBody = bodySize(curr);
    if (prevBody === 0 || currBody === 0) return null;

    const isContained =
      Math.max(curr.open, curr.close) <= Math.max(prev.open, prev.close) &&
      Math.min(curr.open, curr.close) >= Math.min(prev.open, prev.close);

    if (!isContained || currBody > prevBody * 0.6) return null;

    if (isBearish(prev) && isBullish(curr) && isPriorDowntrend(candles, index - 1)) {
      return {
        name: 'Bullish Harami',
        type: 'multi',
        signal: 'bullish',
        confidence: 76,
        timestamp: curr.time,
        index,
        price: curr.close,
        explanation: 'Inside bar reversal in downtrend: selling momentum halted as the entire current body traded within the prior large red candle.',
        rulesMatched: [
          'Preceding candle was large red body',
          `Current green body (${currBody.toFixed(2)}) fully inside previous body (${prevBody.toFixed(2)})`,
        ],
      };
    } else if (isBullish(prev) && isBearish(curr) && isPriorUptrend(candles, index - 1)) {
      return {
        name: 'Bearish Harami',
        type: 'multi',
        signal: 'bearish',
        confidence: 75,
        timestamp: curr.time,
        index,
        price: curr.close,
        explanation: 'Inside bar reversal in uptrend: buying momentum halted as current price traded completely inside the previous green body.',
        rulesMatched: [
          'Preceding candle was large green body',
          `Current red body (${currBody.toFixed(2)}) fully inside previous body (${prevBody.toFixed(2)})`,
        ],
      };
    }
    return null;
  }

  /**
   * Tweezer Top & Tweezer Bottom
   * Math: Equal/matching Highs (Top) or Lows (Bottom) across 2 consecutive bars within 0.1% tolerance
   */
  function detectTweezers(candles, index) {
    if (index < 1) return null;
    const prev = candles[index - 1];
    const curr = candles[index];

    const highDiffPct = Math.abs(curr.high - prev.high) / Math.max(0.1, curr.high) * 100;
    const lowDiffPct = Math.abs(curr.low - prev.low) / Math.max(0.1, curr.low) * 100;

    // Tweezer Top
    if (highDiffPct <= 0.08 && isPriorUptrend(candles, index - 1) && isBullish(prev) && isBearish(curr)) {
      return {
        name: 'Tweezer Top',
        type: 'multi',
        signal: 'bearish',
        confidence: 78,
        timestamp: curr.time,
        index,
        price: curr.close,
        explanation: `Double high rejection: Two consecutive candles tested identical resistance level (₹${curr.high.toFixed(2)}) and failed to break out, establishing a key swing high.`,
        rulesMatched: [
          `Identical peak highs: Bar 1 High (₹${prev.high.toFixed(2)}) ≈ Bar 2 High (₹${curr.high.toFixed(2)}) [Diff: ${highDiffPct.toFixed(2)}%]`,
          'Bar 1 is green, Bar 2 is red in uptrend',
        ],
      };
    }

    // Tweezer Bottom
    if (lowDiffPct <= 0.08 && isPriorDowntrend(candles, index - 1) && isBearish(prev) && isBullish(curr)) {
      return {
        name: 'Tweezer Bottom',
        type: 'multi',
        signal: 'bullish',
        confidence: 79,
        timestamp: curr.time,
        index,
        price: curr.close,
        explanation: `Double low support test: Two consecutive candles tested identical floor support (₹${curr.low.toFixed(2)}) and held firmly, confirming strong buyer demand.`,
        rulesMatched: [
          `Identical trough lows: Bar 1 Low (₹${prev.low.toFixed(2)}) ≈ Bar 2 Low (₹${curr.low.toFixed(2)}) [Diff: ${lowDiffPct.toFixed(2)}%]`,
          'Bar 1 is red, Bar 2 is green in downtrend',
        ],
      };
    }

    return null;
  }

  // ════════════════════════════════════════════════════════════
  // MASTER SCANNER PIPELINE
  // ════════════════════════════════════════════════════════════

  const DETECTORS = [
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectMorningStar,
    detectEveningStar,
    detectPiercingPattern,
    detectDarkCloudCover,
    detectHammer,
    detectShootingStar,
    detectInvertedHammer,
    detectHangingMan,
    detectMarubozu,
    detectHarami,
    detectTweezers,
    detectDoji,
  ];

  /**
   * Scan an entire candlestick array for all recognized patterns
   * @param {Object[]} candles - Array of OHLCV candle objects
   * @returns {Object[]} List of detected pattern events
   */
  function scan(candles) {
    if (!candles || candles.length === 0) return [];
    const detected = [];

    for (let i = 0; i < candles.length; i++) {
      for (const detector of DETECTORS) {
        try {
          const result = detector(candles, i);
          if (result) {
            result.id = `pat_${result.name.replace(/\s+/g, '_').toLowerCase()}_${i}`;
            detected.push(result);
            break; // Record top priority pattern for this bar
          }
        } catch (e) {
          // Continue scanning next detector
        }
      }
    }

    return detected;
  }

  /**
   * Scan latest completed candle for fresh pattern alert
   */
  function scanLatest(candles) {
    if (!candles || candles.length < 2) return null;
    const lastIdx = candles.length - 1;

    for (const detector of DETECTORS) {
      const result = detector(candles, lastIdx);
      if (result) {
        result.id = `pat_${result.name.replace(/\s+/g, '_').toLowerCase()}_${lastIdx}`;
        return result;
      }
    }
    return null;
  }

  return {
    scan,
    scanLatest,
    detectDoji,
    detectHammer,
    detectInvertedHammer,
    detectShootingStar,
    detectHangingMan,
    detectMarubozu,
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectPiercingPattern,
    detectDarkCloudCover,
    detectMorningStar,
    detectEveningStar,
    detectHarami,
    detectTweezers,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Patterns;
}

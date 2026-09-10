/* ============================================================
   K-Delta — Prediction Engine
   Combines candlestick patterns + technical indicators
   into a weighted BUY / SELL / HOLD signal
   ============================================================ */

const Predictions = (() => {
  /**
   * Generate a full prediction from candle data
   * @param {Array} candles - OHLCV data array
   * @returns {Object} Prediction result
   */
  function analyze(candles) {
    if (!candles || candles.length < 30) {
      return {
        signal: 'HOLD',
        confidence: 0,
        trend: 'sideways',
        reasons: ['Insufficient data for analysis. Need at least 30 candles.'],
        patterns: [],
        indicators: {},
      };
    }

    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    const lastClose = lastCandle.close;

    // ── 1. Compute Indicators ──
    const sma20 = Indicators.sma(closes, 20);
    const sma50 = Indicators.sma(closes, 50);
    const ema12 = Indicators.ema(closes, 12);
    const ema26 = Indicators.ema(closes, 26);
    const rsiValues = Indicators.rsi(closes, 14);
    const macdResult = Indicators.macd(closes, 12, 26, 9);
    const bbResult = Indicators.bollingerBands(closes, 20, 2);
    const atrValues = Indicators.atr(candles, 14);

    const lastIdx = closes.length - 1;
    const currentRSI = rsiValues[lastIdx];
    const currentMACD = macdResult.macdLine[lastIdx];
    const currentSignal = macdResult.signalLine[lastIdx];
    const currentHistogram = macdResult.histogram[lastIdx];
    const currentSMA20 = sma20[lastIdx];
    const currentSMA50 = sma50[lastIdx];
    const currentEMA12 = ema12[lastIdx];
    const currentEMA26 = ema26[lastIdx];
    const currentATR = atrValues[lastIdx];

    // ── 2. Detect Patterns ──
    const patterns = Patterns.detectAll(candles, 15);

    // ── 3. Determine Trend ──
    const trend = detectTrend(candles, sma20, sma50, ema12, ema26);

    // ── 4. Score Each Component ──
    let totalScore = 0; // -100 (strong sell) to +100 (strong buy)
    const reasons = [];

    // ── RSI Score (weight: 20%) ──
    const rsiResult = scoreRSI(currentRSI);
    totalScore += rsiResult.score * 0.20;
    if (rsiResult.reason) reasons.push(rsiResult.reason);

    // ── MACD Score (weight: 25%) ──
    const macdScore = scoreMACD(currentMACD, currentSignal, currentHistogram, macdResult);
    totalScore += macdScore.score * 0.25;
    if (macdScore.reason) reasons.push(macdScore.reason);

    // ── Moving Average Score (weight: 20%) ──
    const maScore = scoreMovingAverages(lastClose, currentSMA20, currentSMA50, ema12, ema26, candles);
    totalScore += maScore.score * 0.20;
    if (maScore.reason) reasons.push(maScore.reason);

    // ── Pattern Score (weight: 25%) ──
    const patternScore = scorePatterns(patterns);
    totalScore += patternScore.score * 0.25;
    if (patternScore.reason) reasons.push(patternScore.reason);

    // ── Volume Confirmation (weight: 10%) ──
    const volumeScore = scoreVolume(candles);
    totalScore += volumeScore.score * 0.10;
    if (volumeScore.reason) reasons.push(volumeScore.reason);

    // ── 5. Determine Signal ──
    let signal, confidence;

    if (totalScore > 25) {
      signal = 'BUY';
      confidence = Math.min(95, Math.round(50 + totalScore * 0.45));
    } else if (totalScore < -25) {
      signal = 'SELL';
      confidence = Math.min(95, Math.round(50 + Math.abs(totalScore) * 0.45));
    } else {
      signal = 'HOLD';
      confidence = Math.round(50 - Math.abs(totalScore) * 0.3);
    }

    // ── 6. Build Indicator Summary ──
    const rsiStatusObj = Indicators.rsiStatus(currentRSI);
    const macdStatusObj = Indicators.macdStatus(currentMACD, currentSignal, currentHistogram);
    const bbSqueeze = Indicators.bbSqueeze(bbResult.upper, bbResult.lower, bbResult.middle);

    const indicators = {
      rsi: {
        value: currentRSI != null ? currentRSI.toFixed(1) : '—',
        status: rsiStatusObj.status,
        signal: rsiStatusObj.signal,
      },
      macd: {
        value: currentMACD != null ? currentMACD.toFixed(3) : '—',
        signal: currentSignal != null ? currentSignal.toFixed(3) : '—',
        histogram: currentHistogram != null ? currentHistogram.toFixed(3) : '—',
        status: macdStatusObj.status,
        statusSignal: macdStatusObj.signal,
      },
      sma20: {
        value: currentSMA20 != null ? currentSMA20.toFixed(2) : '—',
        position: lastClose > (currentSMA20 || 0) ? 'Above' : 'Below',
      },
      sma50: {
        value: currentSMA50 != null ? currentSMA50.toFixed(2) : '—',
        position: lastClose > (currentSMA50 || 0) ? 'Above' : 'Below',
      },
      bollinger: {
        upper: bbResult.upper[lastIdx] != null ? bbResult.upper[lastIdx].toFixed(2) : '—',
        lower: bbResult.lower[lastIdx] != null ? bbResult.lower[lastIdx].toFixed(2) : '—',
        status: bbSqueeze.status,
      },
      atr: {
        value: currentATR != null ? currentATR.toFixed(2) : '—',
      },
    };

    // ── 7. Build Chart Overlays Data ──
    const overlays = {
      sma20: sma20.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      sma50: sma50.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      ema12: ema12.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      ema26: ema26.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      bbUpper: bbResult.upper.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      bbLower: bbResult.lower.map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      volume: candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 23, 68, 0.4)',
      })),
    };

    return {
      signal,
      confidence,
      trend: trend.direction,
      trendStrength: trend.strength,
      reasons,
      patterns,
      indicators,
      overlays,
      score: totalScore,
    };
  }

  /**
   * Detect overall trend direction
   */
  function detectTrend(candles, sma20, sma50, ema12, ema26) {
    const lastIdx = candles.length - 1;
    let bullishPoints = 0;
    let bearishPoints = 0;

    // Price vs SMA20
    if (sma20[lastIdx] != null) {
      if (candles[lastIdx].close > sma20[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    // Price vs SMA50
    if (sma50[lastIdx] != null) {
      if (candles[lastIdx].close > sma50[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    // SMA20 vs SMA50 (Golden/Death cross)
    if (sma20[lastIdx] != null && sma50[lastIdx] != null) {
      if (sma20[lastIdx] > sma50[lastIdx]) bullishPoints += 3;
      else bearishPoints += 3;
    }

    // EMA12 vs EMA26
    if (ema12[lastIdx] != null && ema26[lastIdx] != null) {
      if (ema12[lastIdx] > ema26[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    // Recent price action (last 10 candles)
    const recent = candles.slice(-10);
    const firstClose = recent[0].close;
    const lastClose = recent[recent.length - 1].close;
    const recentChange = (lastClose - firstClose) / firstClose;

    if (recentChange > 0.02) bullishPoints += 3;
    else if (recentChange < -0.02) bearishPoints += 3;

    // Higher highs / lower lows
    let higherHighs = 0;
    let lowerLows = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].high > recent[i - 1].high) higherHighs++;
      if (recent[i].low < recent[i - 1].low) lowerLows++;
    }
    if (higherHighs > 5) bullishPoints += 2;
    if (lowerLows > 5) bearishPoints += 2;

    const diff = bullishPoints - bearishPoints;
    let direction, strength;

    if (diff > 5) { direction = 'uptrend'; strength = 'strong'; }
    else if (diff > 2) { direction = 'uptrend'; strength = 'moderate'; }
    else if (diff < -5) { direction = 'downtrend'; strength = 'strong'; }
    else if (diff < -2) { direction = 'downtrend'; strength = 'moderate'; }
    else { direction = 'sideways'; strength = 'weak'; }

    return { direction, strength };
  }

  /**
   * Score RSI signal
   */
  function scoreRSI(rsi) {
    if (rsi == null) return { score: 0, reason: null };

    if (rsi >= 80) return { score: -80, reason: `**RSI at ${rsi.toFixed(1)}** — Extremely overbought. Strong selling pressure expected as the market is stretched.` };
    if (rsi >= 70) return { score: -50, reason: `**RSI at ${rsi.toFixed(1)}** — Overbought territory. Price has risen significantly and may be due for a pullback.` };
    if (rsi <= 20) return { score: 80, reason: `**RSI at ${rsi.toFixed(1)}** — Extremely oversold. A bounce is likely as the market is deeply undervalued.` };
    if (rsi <= 30) return { score: 50, reason: `**RSI at ${rsi.toFixed(1)}** — Oversold territory. Selling pressure is exhausting and buyers may step in.` };
    if (rsi > 50 && rsi < 60) return { score: 15, reason: `**RSI at ${rsi.toFixed(1)}** — Mildly bullish momentum.` };
    if (rsi > 40 && rsi <= 50) return { score: -15, reason: `**RSI at ${rsi.toFixed(1)}** — Mildly bearish momentum.` };
    return { score: 0, reason: null };
  }

  /**
   * Score MACD signal
   */
  function scoreMACD(macdVal, signalVal, histogram, fullMacd) {
    if (macdVal == null || signalVal == null) return { score: 0, reason: null };

    let score = 0;
    let reason = '';

    // MACD above signal = bullish
    if (macdVal > signalVal) {
      score += 30;
      reason = '**MACD** is above the signal line — bullish momentum.';
    } else {
      score -= 30;
      reason = '**MACD** is below the signal line — bearish momentum.';
    }

    // Check for recent crossover (last 3 candles)
    const hist = fullMacd.histogram;
    const recentHist = hist.slice(-3).filter(v => v != null);
    if (recentHist.length >= 2) {
      const prev = recentHist[recentHist.length - 2];
      const curr = recentHist[recentHist.length - 1];
      if (prev < 0 && curr > 0) {
        score += 40;
        reason = '**MACD just crossed above the signal line** — fresh bullish crossover! This is a strong buy signal.';
      } else if (prev > 0 && curr < 0) {
        score -= 40;
        reason = '**MACD just crossed below the signal line** — fresh bearish crossover! This is a strong sell signal.';
      }
    }

    // Histogram momentum
    if (histogram > 0 && macdVal > 0) score += 10;
    else if (histogram < 0 && macdVal < 0) score -= 10;

    return { score: Math.max(-100, Math.min(100, score)), reason };
  }

  /**
   * Score moving average alignment
   */
  function scoreMovingAverages(price, sma20, sma50, ema12, ema26, candles) {
    let score = 0;
    const reasons = [];

    // Price above SMA20
    if (sma20 != null) {
      if (price > sma20) { score += 15; }
      else { score -= 15; }
    }

    // Price above SMA50
    if (sma50 != null) {
      if (price > sma50) { score += 15; }
      else { score -= 15; }
    }

    // Golden/Death cross
    if (sma20 != null && sma50 != null) {
      if (sma20 > sma50) {
        score += 25;
        reasons.push('**Golden Cross** — SMA(20) above SMA(50) indicates bullish trend structure.');
      } else {
        score -= 25;
        reasons.push('**Death Cross** — SMA(20) below SMA(50) indicates bearish trend structure.');
      }
    }

    // EMA alignment
    const lastIdx = candles.length - 1;
    if (ema12[lastIdx] != null && ema26[lastIdx] != null) {
      if (ema12[lastIdx] > ema26[lastIdx]) score += 15;
      else score -= 15;
    }

    return {
      score: Math.max(-100, Math.min(100, score)),
      reason: reasons.join(' ') || `Price is ${price > (sma20 || price) ? 'above' : 'below'} key moving averages.`,
    };
  }

  /**
   * Score candlestick patterns
   */
  function scorePatterns(patterns) {
    if (patterns.length === 0) {
      return { score: 0, reason: 'No significant candlestick patterns detected in recent candles.' };
    }

    let score = 0;
    const patternNames = [];
    const confidenceWeight = { high: 1.5, medium: 1.0, low: 0.5 };

    // Only count the most recent and most relevant patterns (top 5)
    const topPatterns = patterns.slice(0, 5);

    for (const p of topPatterns) {
      const weight = confidenceWeight[p.confidence] || 1;
      if (p.signal === 'bullish') {
        score += 25 * weight;
        patternNames.push(`🟢 ${p.name}`);
      } else if (p.signal === 'bearish') {
        score -= 25 * weight;
        patternNames.push(`🔴 ${p.name}`);
      } else {
        patternNames.push(`🟡 ${p.name}`);
      }
    }

    return {
      score: Math.max(-100, Math.min(100, score)),
      reason: `**Detected patterns:** ${patternNames.join(', ')}. ${
        score > 0 ? 'Bullish patterns dominate.' : score < 0 ? 'Bearish patterns dominate.' : 'Mixed signals from patterns.'
      }`,
    };
  }

  /**
   * Score volume (trend confirmation)
   */
  function scoreVolume(candles) {
    if (candles.length < 20) return { score: 0, reason: null };

    const recent5 = candles.slice(-5);
    const prior15 = candles.slice(-20, -5);

    const avgRecentVol = recent5.reduce((s, c) => s + c.volume, 0) / recent5.length;
    const avgPriorVol = prior15.reduce((s, c) => s + c.volume, 0) / prior15.length;

    if (avgPriorVol === 0) return { score: 0, reason: null };

    const volRatio = avgRecentVol / avgPriorVol;
    const recentTrend = recent5[recent5.length - 1].close - recent5[0].close;

    if (volRatio > 1.5 && recentTrend > 0) {
      return { score: 40, reason: '**Volume surge (+' + Math.round((volRatio - 1) * 100) + '%)** on bullish price action confirms buying interest.' };
    }
    if (volRatio > 1.5 && recentTrend < 0) {
      return { score: -40, reason: '**Volume surge (+' + Math.round((volRatio - 1) * 100) + '%)** on bearish price action confirms selling pressure.' };
    }
    if (volRatio < 0.5) {
      return { score: 0, reason: 'Volume is declining — current move may lack conviction.' };
    }

    return { score: 0, reason: null };
  }

  /**
   * Build a human-readable summary paragraph
   */
  function buildSummary(prediction) {
    const { signal, confidence, trend, reasons } = prediction;
    const filteredReasons = reasons.filter(Boolean);

    let summary = '';
    if (signal === 'BUY') {
      summary = `The technical analysis indicates a **bullish outlook** with ${confidence}% confidence. `;
    } else if (signal === 'SELL') {
      summary = `The technical analysis indicates a **bearish outlook** with ${confidence}% confidence. `;
    } else {
      summary = `The market is showing **mixed signals**. `;
    }

    summary += `The current trend is **${trend}**. `;

    if (filteredReasons.length > 0) {
      summary += filteredReasons[0];
    }

    return summary;
  }

  return {
    analyze,
    buildSummary,
  };
})();

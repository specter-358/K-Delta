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

    // ── 5. Determine Signal & Action ──
    let signal, action, actionType, confidence;

    if (totalScore > 50) {
      signal = 'BUY';
      action = 'STRONG BUY';
      actionType = 'strong-buy';
      confidence = Math.min(96, Math.round(65 + totalScore * 0.35));
    } else if (totalScore > 20) {
      signal = 'BUY';
      action = 'BUY ON PULLBACK';
      actionType = 'buy';
      confidence = Math.min(90, Math.round(50 + totalScore * 0.45));
    } else if (totalScore < -50) {
      signal = 'SELL';
      action = 'STRONG SELL';
      actionType = 'strong-sell';
      confidence = Math.min(96, Math.round(65 + Math.abs(totalScore) * 0.35));
    } else if (totalScore < -20) {
      signal = 'SELL';
      action = 'SELL ON RALLY';
      actionType = 'sell';
      confidence = Math.min(90, Math.round(50 + Math.abs(totalScore) * 0.45));
    } else {
      signal = 'HOLD';
      action = 'WAIT / NO TRADE';
      actionType = 'hold';
      confidence = Math.round(50 - Math.abs(totalScore) * 0.3);
    }

    // ── 5b. Compute Precise Trade Setup (Entry, Targets, Stop Loss, Timing) ──
    const tradeSetup = calculateTradeSetup(lastClose, currentATR, signal, action, trend, bbResult, lastIdx);

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
      action,
      actionType,
      confidence,
      trend: trend.direction,
      trendStrength: trend.strength,
      tradeSetup,
      reasons,
      patterns,
      indicators,
      overlays,
      score: totalScore,
    };
  }

  /**
   * Calculate precise trade entry, stop loss, take profit targets, and exact timing rules
   */
  function calculateTradeSetup(currentPrice, atr, signal, action, trend, bbResult, lastIdx) {
    const validATR = (atr && atr > 0) ? atr : (currentPrice * 0.015);
    const bbUpper = bbResult.upper[lastIdx] || (currentPrice + 2 * validATR);
    const bbLower = bbResult.lower[lastIdx] || (currentPrice - 2 * validATR);

    let entry = currentPrice;
    let entryMin, entryMax, stopLoss, target1, target2, riskReward, actionHeadline, timingAdvice, checklist;

    if (signal === 'BUY') {
      const isStrong = action === 'STRONG BUY';
      entry = currentPrice;
      entryMin = +(currentPrice - validATR * 0.3).toFixed(2);
      entryMax = +(currentPrice + validATR * 0.2).toFixed(2);

      // Stop loss 1.5 ATR below entry
      stopLoss = +(currentPrice - validATR * 1.5).toFixed(2);
      // Target 1: 2 ATR above or upper BB
      target1 = +(Math.max(currentPrice + validATR * 2.0, (bbUpper + currentPrice) / 2)).toFixed(2);
      // Target 2: 3.5 ATR above
      target2 = +(currentPrice + validATR * 3.5).toFixed(2);

      const risk = entry - stopLoss;
      const reward = target1 - entry;
      riskReward = (reward / (risk || 1)).toFixed(1);

      const riskPct = (((stopLoss - entry) / entry) * 100).toFixed(2);
      const target1Pct = (((target1 - entry) / entry) * 100).toFixed(2);
      const target2Pct = (((target2 - entry) / entry) * 100).toFixed(2);

      actionHeadline = isStrong
        ? `🟢 BUY NOW — High conviction bullish setup at $${entry.toFixed(2)}`
        : `🟢 BUY ON PULLBACK — Accumulate between $${entryMin.toFixed(2)} - $${entryMax.toFixed(2)}`;

      timingAdvice = isStrong
        ? `Enter market order or limit at $${entry.toFixed(2)}. Bullish patterns and indicator momentum confirm strong upside probability.`
        : `Place limit buy order between $${entryMin.toFixed(2)} and $${entry.toFixed(2)}. Wait for a slight dip before entering to maximize risk-reward.`;

      checklist = [
        {
          type: 'enter',
          label: 'WHEN TO BUY',
          text: `Enter long position around **$${entry.toFixed(2)}** (Optimal Zone: $${entryMin.toFixed(2)} – $${entryMax.toFixed(2)}).`,
        },
        {
          type: 'target',
          label: 'WHEN TO TAKE PROFIT',
          text: `Sell 50% at **Target 1 ($${target1.toFixed(2)} / +${target1Pct}%)**. Let remaining 50% run to **Target 2 ($${target2.toFixed(2)} / +${target2Pct}%)** while moving stop to breakeven.`,
        },
        {
          type: 'exit',
          label: 'WHEN TO SELL / CUT LOSS',
          text: `Exit 100% if candle closes below **Stop Loss ($${stopLoss.toFixed(2)} / ${riskPct}%)** to protect capital.`,
        },
      ];

      return {
        hasSetup: true,
        type: 'BUY',
        actionHeadline,
        timingAdvice,
        entryPrice: entry,
        entryZone: `$${entryMin.toFixed(2)} – $${entryMax.toFixed(2)}`,
        stopLoss,
        stopLossPct: `${riskPct}%`,
        target1,
        target1Pct: `+${target1Pct}%`,
        target2,
        target2Pct: `+${target2Pct}%`,
        riskReward: `1 : ${riskReward}`,
        timeHorizon: '1 – 5 Days (Swing)',
        checklist,
      };

    } else if (signal === 'SELL') {
      const isStrong = action === 'STRONG SELL';
      entry = currentPrice;
      entryMin = +(currentPrice - validATR * 0.2).toFixed(2);
      entryMax = +(currentPrice + validATR * 0.3).toFixed(2);

      // Stop loss 1.5 ATR above entry
      stopLoss = +(currentPrice + validATR * 1.5).toFixed(2);
      // Target 1: 2 ATR below or lower BB
      target1 = +(Math.min(currentPrice - validATR * 2.0, (bbLower + currentPrice) / 2)).toFixed(2);
      // Target 2: 3.5 ATR below
      target2 = +(currentPrice - validATR * 3.5).toFixed(2);

      const risk = stopLoss - entry;
      const reward = entry - target1;
      riskReward = (reward / (risk || 1)).toFixed(1);

      const riskPct = (((entry - stopLoss) / entry) * 100).toFixed(2);
      const target1Pct = (((target1 - entry) / entry) * 100).toFixed(2);
      const target2Pct = (((target2 - entry) / entry) * 100).toFixed(2);

      actionHeadline = isStrong
        ? `🔴 SELL / TAKE PROFIT NOW — Heavy bearish pressure at $${entry.toFixed(2)}`
        : `🔴 SELL ON RALLY — Exit long positions or short into resistance at $${entryMax.toFixed(2)}`;

      timingAdvice = isStrong
        ? `Close active long positions immediately or consider short entry at $${entry.toFixed(2)}. Technical breakdown is in progress.`
        : `Sell into current mini-bounces between $${entry.toFixed(2)} - $${entryMax.toFixed(2)}. Avoid holding long positions as overhead supply is high.`;

      checklist = [
        {
          type: 'enter',
          label: 'WHEN TO SELL / SHORT',
          text: `Liquidate longs or enter short around **$${entry.toFixed(2)}** (Rally Zone: $${entry.toFixed(2)} – $${entryMax.toFixed(2)}).`,
        },
        {
          type: 'target',
          label: 'WHEN TO BUY BACK (COVER)',
          text: `Cover 50% short at **Target 1 ($${target1.toFixed(2)} / ${target1Pct}%)**. Take remaining profit at **Target 2 ($${target2.toFixed(2)} / ${target2Pct}%)**.`,
        },
        {
          type: 'exit',
          label: 'STOP LOSS FOR SHORTS',
          text: `Exit short if price closes above **Stop Loss ($${stopLoss.toFixed(2)} / +${Math.abs(riskPct)}%)**.`,
        },
      ];

      return {
        hasSetup: true,
        type: 'SELL',
        actionHeadline,
        timingAdvice,
        entryPrice: entry,
        entryZone: `$${entryMin.toFixed(2)} – $${entryMax.toFixed(2)}`,
        stopLoss,
        stopLossPct: `+${Math.abs(riskPct)}%`,
        target1,
        target1Pct: `${target1Pct}%`,
        target2,
        target2Pct: `${target2Pct}%`,
        riskReward: `1 : ${riskReward}`,
        timeHorizon: '1 – 5 Days (Swing)',
        checklist,
      };

    } else {
      // HOLD / WAIT
      const breakoutBuy = +(currentPrice + validATR * 1.2).toFixed(2);
      const breakdownSell = +(currentPrice - validATR * 1.2).toFixed(2);

      actionHeadline = `⏳ WAIT / NO CLEAR SETUP — Market is in consolidation at $${currentPrice.toFixed(2)}`;
      timingAdvice = `Do not take new positions right now. Wait for a clear breakout above $${breakoutBuy.toFixed(2)} (Buy trigger) or breakdown below $${breakdownSell.toFixed(2)} (Sell trigger).`;

      checklist = [
        {
          type: 'wait',
          label: 'WHEN TO BUY (TRIGGER)',
          text: `Buy only if candle breaks out and closes above **$${breakoutBuy.toFixed(2)}** with rising volume.`,
        },
        {
          type: 'wait',
          label: 'WHEN TO SELL (TRIGGER)',
          text: `Sell / Short only if candle breaks down below **$${breakdownSell.toFixed(2)}** support.`,
        },
        {
          type: 'hold',
          label: 'CURRENT ACTION',
          text: `Stay in cash or hold existing position with a trailing stop. No high-probability edge detected currently.`,
        },
      ];

      return {
        hasSetup: false,
        type: 'HOLD',
        actionHeadline,
        timingAdvice,
        entryPrice: currentPrice,
        entryZone: `Consolidation ($${breakdownSell.toFixed(2)} – $${breakoutBuy.toFixed(2)})`,
        stopLoss: breakdownSell,
        stopLossPct: 'Trigger',
        target1: breakoutBuy,
        target1Pct: 'Trigger',
        target2: +(breakoutBuy + validATR).toFixed(2),
        target2Pct: 'Trigger',
        riskReward: 'N/A',
        timeHorizon: 'Wait for Breakout',
        checklist,
      };
    }
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

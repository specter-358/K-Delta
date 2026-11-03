/* ============================================================
   K-Delta — Quantitative Prediction Engine & Trade Lifecycle
   Intraday Long Lifecycle: NO_POSITION → BUY → OPEN_LONG → HOLD → SELL → CLOSED
   Strict Market Timing (09:15–15:30 IST) & Real Data Accuracy
   ============================================================ */

// Resolve indicator & pattern modules safely across Browser and Node environments
let IndicatorsModule = typeof Indicators !== 'undefined' ? Indicators : null;
if (!IndicatorsModule && typeof require !== 'undefined') {
  try { IndicatorsModule = require('./indicators'); } catch (e) {}
}

let PatternsModule = typeof Patterns !== 'undefined' ? Patterns : null;
if (!PatternsModule && typeof require !== 'undefined') {
  try { PatternsModule = require('./patterns'); } catch (e) {}
}

const Predictions = (() => {

  /**
   * Helper: Parse Asia/Kolkata (IST) Market Session Info
   */
  function getIntradaySessionInfo(dateParam = new Date()) {
    const d = (dateParam instanceof Date) ? dateParam : new Date(dateParam);
    const istFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });

    const parts = istFormatter.formatToParts(d);
    const map = {};
    parts.forEach(p => map[p.type] = p.value);

    const weekday = map.weekday;
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const totalMinutes = hour * 60 + minute;
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';

    const isPreMarket = !isWeekend && (totalMinutes < 555); // Before 09:15 IST
    const isRegularTrading = !isWeekend && (totalMinutes >= 555 && totalMinutes < 915); // 09:15 to 15:15 IST
    const isSquareOffWindow = !isWeekend && (totalMinutes >= 915 && totalMinutes < 930); // 15:15 to 15:30 IST
    const isPostMarket = !isWeekend && (totalMinutes >= 930 && totalMinutes < 960); // 15:30 to 16:00 IST
    const isMarketClosed = isWeekend || (totalMinutes >= 960);

    return {
      isWeekend,
      isPreMarket,
      isRegularTrading,
      isSquareOffWindow,
      isPostMarket,
      isMarketClosed,
      totalMinutes,
      canEnterNewTrade: isRegularTrading && totalMinutes <= 900, // Safe entry up to 15:00
      shouldSquareOff: isSquareOffWindow || (!isRegularTrading && !isPreMarket),
    };
  }

  /**
   * Helper: Convert candle time (unix seconds or date) to IST time
   */
  function getCandleISTTime(candleTime) {
    if (candleTime == null) return null;
    let d;
    if (typeof candleTime === 'number') {
      d = new Date(candleTime * 1000);
    } else {
      d = new Date(candleTime);
    }
    if (isNaN(d.getTime())) return null;

    const istStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const istDate = new Date(istStr);
    const hour = istDate.getHours();
    const minute = istDate.getMinutes();
    return { hour, minute, totalMinutes: hour * 60 + minute };
  }

  /**
   * Run Intraday Trade Lifecycle State Machine across candle series
   * Enforces: NO_POSITION → BUY (Entry) → OPEN_LONG → HOLD → SELL (Exit) → CLOSED
   * Never loops BUY → BUY → BUY while a position is open.
   */
  function runTradeLifecycle(candles, options = {}) {
    if (!candles || candles.length < 20 || !IndicatorsModule) {
      return {
        trades: [],
        tradeEvents: [],
        activeTrade: null,
        currentState: 'NO_POSITION',
      };
    }

    const closes = candles.map(c => c.close);
    const sma20 = IndicatorsModule.sma(closes, 20);
    const ema12 = IndicatorsModule.ema(closes, 12);
    const ema26 = IndicatorsModule.ema(closes, 26);
    const rsiList = IndicatorsModule.rsi(closes, 14);
    const macdResult = IndicatorsModule.macd(closes, 12, 26, 9);
    const atrList = IndicatorsModule.atr(candles, 14);

    const macdArr = macdResult ? (macdResult.macd || macdResult.macdLine || []) : [];
    const sigArr = macdResult ? (macdResult.signal || macdResult.signalLine || []) : [];

    let state = 'NO_POSITION';
    let currentTrade = null;
    const trades = [];
    const tradeEvents = [];

    const startIdx = Math.min(20, candles.length - 1);

    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i];
      const prevCandle = i > 0 ? candles[i - 1] : candle;
      const close = candle.close;
      const high = candle.high;
      const low = candle.low;
      const open = candle.open;
      const atr = (atrList && atrList[i] > 0) ? atrList[i] : (close * 0.015);
      const rsi = (rsiList && rsiList[i] != null) ? rsiList[i] : 50;
      const macdVal = macdArr[i] ?? 0;
      const sigVal = sigArr[i] ?? 0;
      const prevMacd = (i > 0 && macdArr) ? macdArr[i - 1] : macdVal;
      const prevSig = (i > 0 && sigArr) ? sigArr[i - 1] : sigVal;
      const macdCrossUp = prevMacd <= prevSig && macdVal > sigVal;
      const macdCrossDown = prevMacd >= prevSig && macdVal < sigVal;

      const istTime = getCandleISTTime(candle.time);
      const isSquareOffTime = istTime && (istTime.totalMinutes >= 915); // >= 15:15 IST
      const isEodBar = (i < candles.length - 1 && istTime) ? (
        getCandleISTTime(candles[i + 1].time) && getCandleISTTime(candles[i + 1].time).totalMinutes < istTime.totalMinutes
      ) : false;

      const isIntraday = options.isIntraday !== false;

      if (state === 'NO_POSITION' || state === 'CLOSED') {
        // ENTRY LOGIC:
        // Must be in valid trading hours (09:20 to 14:45 IST) if intraday
        const timeAllowed = !isIntraday || !istTime || (istTime.totalMinutes >= 560 && istTime.totalMinutes <= 885);
        
        // 1. Trend: Close above SMA20 or EMA12 >= EMA26
        const trendOk = (sma20[i] != null ? close > sma20[i] : true) && (ema12[i] != null && ema26[i] != null ? ema12[i] >= ema26[i] : true);

        // 2. Momentum: MACD / EMA alignment (graceful when fewer candles)
        let macdOk = false;
        if (macdArr[i] != null && sigArr[i] != null) {
          macdOk = macdVal >= sigVal || macdCrossUp;
        } else if (macdArr[i] != null) {
          macdOk = macdVal >= 0;
        } else if (ema12[i] != null && ema26[i] != null) {
          macdOk = ema12[i] >= ema26[i];
        } else {
          macdOk = sma20[i] != null ? close >= sma20[i] : true;
        }

        // 3. RSI: Healthy momentum, not deep breakdown or extreme overbought (> 82)
        const rsiOk = rsi == null || (rsi >= 38 && rsi <= 82);

        // 4. Candle structure & expansion: Higher high or price breakout with green candle
        const makesHigherHigh = close > prevCandle.high || (high > prevCandle.high && close > prevCandle.close);
        const hasProgress = i >= 4 ? close > candles[i - 4].close : true;
        const candleOk = close > open && makesHigherHigh && hasProgress;

        if (timeAllowed && trendOk && rsiOk && macdOk && candleOk) {
          const entryPrice = close;
          const stopLoss = +(entryPrice - atr * 1.5).toFixed(2);
          const target1 = +(entryPrice + atr * 2.0).toFixed(2);
          const target2 = +(entryPrice + atr * 3.5).toFixed(2);

          currentTrade = {
            id: `trade_${candle.time || i}`,
            entryBar: i,
            entryTime: candle.time,
            entryPrice,
            stopLoss,
            target1,
            target2,
            status: 'OPEN_LONG',
          };

          state = 'OPEN_LONG';

          tradeEvents.push({
            time: candle.time,
            type: 'BUY',
            price: entryPrice,
            stopLoss,
            target1,
            target2,
            text: `BUY @ ₹${entryPrice.toFixed(1)}`,
            tradeId: currentTrade.id,
          });
        }
      } else if (state === 'OPEN_LONG') {
        // POSITION IS ALREADY OPEN:
        // Dynamic Trailing Stop: protect gains as trade progresses into profit
        if (high >= currentTrade.entryPrice + atr * 1.0) {
          const breakevenSL = +(currentTrade.entryPrice + atr * 0.1).toFixed(2);
          if (breakevenSL > currentTrade.stopLoss) {
            currentTrade.stopLoss = breakevenSL;
          }
        }
        if (high >= currentTrade.entryPrice + atr * 1.8) {
          const trailSL = +(high - atr * 1.2).toFixed(2);
          if (trailSL > currentTrade.stopLoss) {
            currentTrade.stopLoss = trailSL;
          }
        }

        // Strictly evaluate EXIT conditions. DO NOT issue another BUY signal.
        let isExit = false;
        let exitPrice = close;
        let exitReason = '';

        // 1. Target Reached
        if (high >= currentTrade.target1) {
          isExit = true;
          exitPrice = currentTrade.target1;
          exitReason = 'Target reached';
        }
        // 2. Stop Loss Reached
        else if (low <= currentTrade.stopLoss) {
          isExit = true;
          exitPrice = currentTrade.stopLoss;
          exitReason = 'Stop loss reached';
        }
        // 3. Bearish Reversal Confirmed
        else if (
          (macdArr[i] != null && sigArr[i] != null && macdCrossDown && rsi < 50) ||
          (sma20[i] != null && close < sma20[i] && (prevCandle.close < (sma20[i - 1] || close) || rsi < 53))
        ) {
          isExit = true;
          exitPrice = close;
          exitReason = 'Bearish exit signal';
        }
        // 4. End-of-session square-off (15:15 IST)
        else if (isIntraday && (isSquareOffTime || isEodBar)) {
          isExit = true;
          exitPrice = close;
          exitReason = 'End-of-session square-off';
        }

        if (isExit) {
          const pnl = exitPrice - currentTrade.entryPrice;
          const pnlPct = +(((pnl) / currentTrade.entryPrice) * 100).toFixed(2);

          currentTrade.exitBar = i;
          currentTrade.exitTime = candle.time;
          currentTrade.exitPrice = +exitPrice.toFixed(2);
          currentTrade.exitReason = exitReason;
          currentTrade.pnl = +pnl.toFixed(2);
          currentTrade.pnlPct = pnlPct;
          currentTrade.outcome = pnl >= 0 ? 'WIN' : 'LOSS';
          currentTrade.status = 'CLOSED';

          trades.push({ ...currentTrade });

          tradeEvents.push({
            time: candle.time,
            type: 'SELL',
            price: currentTrade.exitPrice,
            reason: exitReason,
            pnlPct,
            text: `SELL: ${exitReason.replace(' reached', '')} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
            tradeId: currentTrade.id,
          });

          state = 'CLOSED';
          currentTrade = null;
        }
      }
    }

    return {
      trades,
      tradeEvents,
      activeTrade: currentTrade,
      currentState: state,
    };
  }

  /**
   * Generate a full prediction from candle data with position lifecycle
   * @param {Array} candles - OHLCV data array
   * @param {string} symbol - Ticker symbol
   * @param {Object} options - { userPosition, isIntraday, currentTime }
   * @returns {Object} Complete Prediction result
   */
  function analyze(candles, symbol = '^NSEI', options = {}) {
    if (!candles || candles.length < 20) {
      return {
        signal: 'WAIT FOR CONFIRMATION',
        action: 'INSUFFICIENT DATA',
        actionType: 'hold',
        confidence: 0,
        trend: 'sideways',
        trendStrength: 'weak',
        positionState: 'NO_POSITION',
        activeTrade: null,
        tradeEvents: [],
        tradeSetup: {
          hasSetup: false,
          positionStatus: 'NO_POSITION',
          actionHeadline: 'Insufficient market data. Need at least 20 bars for technical confirmation.',
          timingAdvice: 'Wait for sufficient candles to load before executing trades.',
          checklist: [],
        },
        reasons: ['Insufficient market data. Need at least 20 bars for accurate calculation.'],
        patterns: [],
        indicators: {},
        overlays: {},
        score: 0,
      };
    }

    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    const lastClose = lastCandle.close;
    const lastIdx = closes.length - 1;

    // ── 1. Compute Indicators ──
    const sma20 = IndicatorsModule ? IndicatorsModule.sma(closes, 20) : [];
    const sma50 = IndicatorsModule ? IndicatorsModule.sma(closes, 50) : [];
    const ema12 = IndicatorsModule ? IndicatorsModule.ema(closes, 12) : [];
    const ema26 = IndicatorsModule ? IndicatorsModule.ema(closes, 26) : [];
    const rsiValues = IndicatorsModule ? IndicatorsModule.rsi(closes, 14) : [];
    const macdResult = IndicatorsModule ? IndicatorsModule.macd(closes, 12, 26, 9) : null;
    const bbResult = IndicatorsModule ? IndicatorsModule.bollingerBands(closes, 20, 2) : { upper: [], lower: [], middle: [] };
    const atrValues = IndicatorsModule ? IndicatorsModule.atr(candles, 14) : [];
    const adxValues = (IndicatorsModule && IndicatorsModule.adx) ? IndicatorsModule.adx(candles, 14) : [];
    const obvValues = (IndicatorsModule && IndicatorsModule.obv) ? IndicatorsModule.obv(candles) : [];
    const srLevels = (IndicatorsModule && IndicatorsModule.supportResistance) ? IndicatorsModule.supportResistance(candles) : { support: [], resistance: [] };

    const currentRSI = rsiValues ? rsiValues[lastIdx] : 50;
    const macdArr = macdResult ? (macdResult.macd || macdResult.macdLine || []) : [];
    const sigArr = macdResult ? (macdResult.signal || macdResult.signalLine || []) : [];
    const histArr = macdResult ? (macdResult.histogram || []) : [];
    const currentMACD = macdArr[lastIdx] ?? 0;
    const currentSignal = sigArr[lastIdx] ?? 0;
    const currentHistogram = histArr[lastIdx] ?? 0;
    const currentSMA20 = sma20 ? sma20[lastIdx] : lastClose;
    const currentSMA50 = sma50 ? sma50[lastIdx] : lastClose;
    const currentEMA12 = ema12 ? ema12[lastIdx] : lastClose;
    const currentEMA26 = ema26 ? ema26[lastIdx] : lastClose;
    const currentATR = atrValues ? atrValues[lastIdx] : (lastClose * 0.015);
    const currentADX = adxValues ? adxValues[lastIdx] : null;

    // RSI Divergence Detection (high-reliability reversal signal)
    const divergence = (IndicatorsModule && IndicatorsModule.rsiDivergence) ? IndicatorsModule.rsiDivergence(candles, rsiValues, 20) : null;

    // Support / Resistance proximity flags
    const nearResistance = srLevels.resistance.some(r => Math.abs(lastClose - r) / lastClose < 0.012);
    const nearSupport = srLevels.support.some(s => Math.abs(lastClose - s) / lastClose < 0.012);

    // ── 2. Detect Patterns ──
    const patterns = (PatternsModule && PatternsModule.scan) ? (PatternsModule.scan(candles, 15) || []) : [];

    // ── 3. Determine Trend (now with ADX strength validation) ──
    const trend = detectTrend(candles, sma20, sma50, ema12, ema26, currentADX);

    // ── 4. Score Each Component (Rebalanced Weights for Maximum Accuracy) ──
    // Weights: RSI 12% | MACD 18% | MAs 13% | Patterns 17% | Volume 15% | Divergence 13% | S/R 12%
    let totalScore = 0; // -100 to +100
    const reasons = [];

    const rsiResult = scoreRSI(currentRSI);
    totalScore += rsiResult.score * 0.12;
    if (rsiResult.reason) reasons.push(rsiResult.reason);

    const macdScore = scoreMACD(currentMACD, currentSignal, currentHistogram, macdResult);
    totalScore += macdScore.score * 0.18;
    if (macdScore.reason) reasons.push(macdScore.reason);

    const maScore = scoreMovingAverages(lastClose, currentSMA20, currentSMA50, ema12, ema26, candles);
    totalScore += maScore.score * 0.13;
    if (maScore.reason) reasons.push(maScore.reason);

    const patternScore = scorePatterns(patterns, candles.length);
    totalScore += patternScore.score * 0.17;
    if (patternScore.reason) reasons.push(patternScore.reason);

    const volumeScore = scoreVolume(candles, obvValues);
    totalScore += volumeScore.score * 0.15;
    if (volumeScore.reason) reasons.push(volumeScore.reason);

    // ── 4b. RSI Divergence Score (NEW — high-reliability reversal signal) ──
    const divScore = scoreDivergence(divergence);
    totalScore += divScore.score * 0.13;
    if (divScore.reason) reasons.push(divScore.reason);

    // ── 4c. Support/Resistance Context Score (NEW — avoid buying at resistance) ──
    const srScore = scoreSupportResistance(lastClose, srLevels, currentATR, trend);
    totalScore += srScore.score * 0.12;
    if (srScore.reason) reasons.push(srScore.reason);

    // ── 5. Run Intraday Trade Lifecycle State Machine across history ──
    const isIntradayTf = options.isIntraday !== false;
    const lifecycle = runTradeLifecycle(candles, { isIntraday: isIntradayTf });
    const { trades, tradeEvents, activeTrade } = lifecycle;

    // ── 6. Check Market Session Context (IST) ──
    const sessionInfo = getIntradaySessionInfo(options.currentTime || new Date());

    // ── 7. Resolve Effective Position State ──
    // Prioritize explicit user position if recorded, else strategy's active trade
    let effectivePositionState = 'NO_POSITION';
    let currentOpenTrade = null;

    if (options.userPosition && options.userPosition.status === 'OPEN_LONG') {
      effectivePositionState = 'OPEN_LONG';
      currentOpenTrade = options.userPosition;
    } else if (activeTrade && activeTrade.status === 'OPEN_LONG') {
      effectivePositionState = 'OPEN_LONG';
      currentOpenTrade = activeTrade;
    }

    // ── 8. Determine Trading Signal & Action from Single Source of Truth ──
    let signal = 'HOLD STOCK';
    let action = 'HOLD STOCK / WAIT';
    let actionType = 'hold';
    let confidence = 50;
    let exitReason = null;

    if (effectivePositionState === 'OPEN_LONG' && currentOpenTrade) {
      // ══════════════════════════════════════════════════════════
      // SCENARIO: POSITION IS CURRENTLY OPEN
      // DO NOT OUTPUT A BUY SIGNAL. Only HOLD or SELL.
      // ══════════════════════════════════════════════════════════
      const entryPrice = currentOpenTrade.entryPrice;
      const target1 = currentOpenTrade.target1 || +(entryPrice + currentATR * 2.0).toFixed(2);
      const target2 = currentOpenTrade.target2 || +(entryPrice + currentATR * 3.5).toFixed(2);
      const stopLoss = currentOpenTrade.stopLoss || +(entryPrice - currentATR * 1.5).toFixed(2);
      const pnl = lastClose - entryPrice;
      const pnlPct = +(((pnl) / entryPrice) * 100).toFixed(2);

      // Check Exit Conditions on latest price
      if (lastClose >= target1 || lastCandle.high >= target1) {
        signal = 'SELL STOCK';
        action = 'EXIT: TARGET 1 REACHED';
        actionType = 'sell';
        exitReason = 'Target reached';
        confidence = 95;
      } else if (lastClose <= stopLoss || lastCandle.low <= stopLoss) {
        signal = 'SELL STOCK';
        action = 'EXIT: STOP LOSS TRIGGERED';
        actionType = 'sell';
        exitReason = 'Stop loss reached';
        confidence = 95;
      } else if (currentMACD < currentSignal && currentRSI < 45) {
        signal = 'SELL STOCK';
        action = 'EXIT: BEARISH REVERSAL';
        actionType = 'sell';
        exitReason = 'Bearish exit signal';
        confidence = 88;
      } else if (isIntradayTf && sessionInfo.shouldSquareOff) {
        signal = 'SELL STOCK';
        action = 'EXIT: INTRADAY SQUARE-OFF';
        actionType = 'sell';
        exitReason = 'End-of-session square-off';
        confidence = 98;
      } else {
        // Holding position within valid risk boundaries
        signal = 'HOLD STOCK';
        action = 'HOLD LONG POSITION';
        actionType = 'hold';
        confidence = Math.min(94, Math.max(68, Math.round(75 + (pnlPct > 0 ? pnlPct * 3 : pnlPct * 2))));
      }

      // Sync active trade targets
      currentOpenTrade.target1 = target1;
      currentOpenTrade.target2 = target2;
      currentOpenTrade.stopLoss = stopLoss;

    } else {
      // ══════════════════════════════════════════════════════════
      // SCENARIO: NO POSITION OPEN
      // Evaluate if fresh BUY setup exists, or WAIT / AVOID
      // ══════════════════════════════════════════════════════════

      if (isIntradayTf && sessionInfo.isPreMarket) {
        signal = 'WAIT FOR OPEN';
        action = 'PRE-MARKET (WAIT FOR 09:15 IST)';
        actionType = 'hold';
        confidence = 50;
      } else if (isIntradayTf && sessionInfo.isSquareOffWindow) {
        signal = 'WAIT';
        action = 'SESSION CLOSING — NO NEW ENTRIES';
        actionType = 'hold';
        confidence = 50;
      } else if (totalScore >= 45 && currentRSI >= 38 && currentRSI <= 75 && lastClose >= (currentSMA20 || lastClose)) {
        // Confirmed Bullish Confluence (Threshold raised from 38→45, RSI widened 40-68→38-75)
        // Reduce confidence near resistance to avoid buying at walls
        let buyConfidence = Math.min(96, Math.round(62 + totalScore * 0.35));
        if (nearResistance) {
          buyConfidence = Math.max(40, buyConfidence - 18);
          reasons.push('⚠️ Price is near **resistance level** — entry carries higher risk.');
        }
        if (nearSupport) {
          buyConfidence = Math.min(96, buyConfidence + 8);
          reasons.push('✅ Price is near **support level** — favorable entry zone.');
        }
        // Taper confidence for RSI > 68 (momentum still valid but more extended)
        if (currentRSI > 68) {
          buyConfidence = Math.max(45, buyConfidence - Math.round((currentRSI - 68) * 1.5));
        }
        signal = 'BUY STOCK';
        action = totalScore > 60 ? 'STRONG BUY STOCK' : 'BUY STOCK ON PULLBACK';
        actionType = totalScore > 60 ? 'strong-buy' : 'buy';
        confidence = buyConfidence;
      } else if (totalScore <= -38) {
        // Confirmed Bearish Structure (Threshold tightened from -35→-38)
        let sellConfidence = Math.min(96, Math.round(55 + Math.abs(totalScore) * 0.35));
        if (nearSupport) {
          sellConfidence = Math.max(40, sellConfidence - 15);
          reasons.push('⚠️ Price is near **support level** — short entry may bounce.');
        }
        signal = 'SELL STOCK';
        action = totalScore < -60 ? 'STRONG SELL STOCK' : 'SELL / SHORT ON RALLY';
        actionType = 'sell';
        confidence = sellConfidence;
      } else {
        // Low Edge / Consolidation
        signal = 'WAIT FOR CONFIRMATION';
        action = 'NO CLEAR SIGNAL / CONSOLIDATION';
        actionType = 'hold';
        confidence = Math.max(30, Math.round(48 - Math.abs(totalScore) * 0.25));
      }
    }

    // ── 9. Compute Comprehensive Trade Setup Matching Single Source of Truth ──
    const tradeSetup = calculateTradeSetup(
      lastClose,
      currentATR,
      signal,
      action,
      trend,
      bbResult,
      lastIdx,
      {
        positionStatus: effectivePositionState,
        activeTrade: currentOpenTrade,
        exitReason,
        sessionInfo,
        isIntraday: isIntradayTf,
        srLevels,
      }
    );

    // ── 10. Run Authentic Historical Backtest from Lifecycle Trades (with slippage) ──
    const backtest = runBacktest(trades, candles);

    // ── 11. Compute 5-Bar Forward Price Forecast (mean-reversion aware) ──
    const forecast = computeForecast(lastClose, currentATR, signal, confidence, trend, { sma20Value: currentSMA20, bbResult, lastIdx, srLevels });

    // ── 12. Compute Algorithmic Confluence Matrix ──
    const confluence = computeConfluenceMatrix(totalScore, rsiResult, macdScore, maScore, patternScore, volumeScore, divScore, srScore);

    // ── 13. Build Indicator Summary ──
    const rsiStatusObj = IndicatorsModule ? IndicatorsModule.rsiStatus(currentRSI) : { status: 'Neutral', signal: 'neutral' };
    const macdStatusObj = IndicatorsModule ? IndicatorsModule.macdStatus(currentMACD, currentSignal, currentHistogram) : { status: 'Neutral', signal: 'neutral' };
    const bbSqueeze = IndicatorsModule ? IndicatorsModule.bbSqueeze(bbResult.upper, bbResult.lower, bbResult.middle) : { status: 'Normal' };

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

    // ── 14. Build Chart Overlays Data ──
    const overlays = {
      sma20: (sma20 || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      sma50: (sma50 || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      ema12: (ema12 || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      ema26: (ema26 || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      bbUpper: (bbResult.upper || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
      bbLower: (bbResult.lower || []).map((v, i) => v != null ? { time: candles[i].time, value: v } : null).filter(Boolean),
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
      positionState: effectivePositionState,
      activeTrade: currentOpenTrade,
      tradeEvents,
      tradeSetup,
      backtest,
      forecast,
      confluence,
      reasons,
      patterns,
      indicators,
      overlays,
      score: totalScore,
    };
  }

  /**
   * Calculate precise trade entry, stop loss, take profit targets, and context-aware timing rules
   */
  function calculateTradeSetup(currentPrice, atr, signal, action, trend, bbResult, lastIdx, positionContext = {}) {
    const validATR = (atr && atr > 0) ? atr : (currentPrice * 0.015);
    const bbUpper = (bbResult && bbResult.upper && bbResult.upper[lastIdx]) || (currentPrice + 2 * validATR);
    const bbLower = (bbResult && bbResult.lower && bbResult.lower[lastIdx]) || (currentPrice - 2 * validATR);

    const { positionStatus = 'NO_POSITION', activeTrade = null, exitReason = null, isIntraday = true } = positionContext;

    let entry = currentPrice;
    let entryMin, entryMax, stopLoss, target1, target2, riskReward, actionHeadline, timingAdvice, checklist;

    const isBuySignal = (signal.includes('BUY') || action.includes('BUY')) && !signal.includes('NO BUY') && !action.includes('AVOID') && !action.includes('BEARISH');
    const isSellSignal = (signal.includes('SELL') || action.includes('SELL') || signal.includes('NO BUY') || action.includes('BEARISH')) && !signal.includes('WAIT');

    if (positionStatus === 'OPEN_LONG' && activeTrade) {
      // ══════════════════════════════════════════════════════════
      // SETUP FOR EXISTING OPEN POSITION (Long)
      // Answers: "Sell what, and why?" or "Hold with what targets?"
      // ══════════════════════════════════════════════════════════
      entry = activeTrade.entryPrice;
      entryMin = +(entry - validATR * 0.2).toFixed(2);
      entryMax = +(entry + validATR * 0.2).toFixed(2);
      stopLoss = activeTrade.stopLoss || +(entry - validATR * 1.5).toFixed(2);
      target1 = activeTrade.target1 || +(entry + validATR * 2.0).toFixed(2);
      target2 = activeTrade.target2 || +(entry + validATR * 3.5).toFixed(2);

      const pnl = currentPrice - entry;
      const pnlPct = +(((pnl) / entry) * 100).toFixed(2);
      const risk = Math.max(0.1, entry - stopLoss);
      const reward = Math.max(0.1, target1 - entry);
      riskReward = (reward / risk).toFixed(1);

      const riskPct = (((stopLoss - entry) / entry) * 100).toFixed(2);
      const target1Pct = (((target1 - entry) / entry) * 100).toFixed(2);
      const target2Pct = (((target2 - entry) / entry) * 100).toFixed(2);

      if (exitReason) {
        // Exit condition is met now: Show SELL with specific reason
        actionHeadline = `SELL STOCK NOW — ${exitReason.toUpperCase()} at ₹${currentPrice.toFixed(2)}`;
        timingAdvice = `Exit open position immediately. Reason: ${exitReason}. Protect capital and lock in trade result.`;

        checklist = [
          {
            type: 'exit',
            label: 'EXIT TRIGGER',
            text: `Execute SELL order at ₹${currentPrice.toFixed(2)}. Condition satisfied: **${exitReason}**.`,
          },
          {
            type: 'target',
            label: 'UNREALIZED P&L',
            text: `Trade P&L: **${pnlPct >= 0 ? '+' : ''}${pnlPct}% (₹${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}/share)** from entry ₹${entry.toFixed(2)}.`,
          },
          {
            type: 'hold',
            label: 'POST-EXIT DISCIPLINE',
            text: `Position closed. Do not chase immediately. Await next confirmed trade setup.`,
          },
        ];
      } else {
        // Position remains open: Show HOLD with stop & target management
        actionHeadline = `HOLD POSITION — Trade active at ₹${entry.toFixed(2)} (Current: ₹${currentPrice.toFixed(2)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`;
        timingAdvice = `Hold position. Target 1 is ₹${target1.toFixed(2)} (+${target1Pct}%). Keep Stop Loss active at ₹${stopLoss.toFixed(2)} (${riskPct}%).`;

        checklist = [
          {
            type: 'hold',
            label: 'POSITION STATUS',
            text: `Position: **OPEN (LONG)** | Bought at: **₹${entry.toFixed(2)}** | Current P&L: **${pnlPct >= 0 ? '+' : ''}${pnlPct}%**.`,
          },
          {
            type: 'target',
            label: 'WHEN TO TAKE PROFIT (EXIT BUY)',
            text: `Exit 50% at **Target 1 (₹${target1.toFixed(2)} / +${target1Pct}%)**. Move stop to breakeven for **Target 2 (₹${target2.toFixed(2)} / +${target2Pct}%)**.`,
          },
          {
            type: 'exit',
            label: 'WHEN TO CUT LOSS (EXIT BUY)',
            text: `Exit 100% immediately if price touches or closes below **Stop Loss (₹${stopLoss.toFixed(2)} / ${riskPct}%)**.`,
          },
          {
            type: 'exit',
            label: 'INTRADAY SQUARE-OFF',
            text: `Mandatory square-off by **15:15 IST** if targets or stop-loss are not triggered earlier.`,
          },
        ];
      }

      return {
        hasSetup: true,
        positionStatus: 'OPEN_LONG',
        boughtPrice: entry,
        currentPrice,
        pnl,
        pnlPct,
        type: exitReason ? 'SELL / EXIT' : 'HOLD POSITION',
        actionHeadline,
        timingAdvice,
        entryPrice: entry,
        entryZone: `₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}`,
        stopLoss,
        stopLossPct: `${riskPct}%`,
        target1,
        target1Pct: `+${target1Pct}%`,
        target2,
        target2Pct: `+${target2Pct}%`,
        riskReward: `1 : ${riskReward}`,
        timeHorizon: isIntraday ? 'Intraday (Same Day)' : '1 – 5 Days (Swing)',
        exitReason: exitReason || null,
        checklist,
      };

    } else if (isBuySignal) {
      // ══════════════════════════════════════════════════════════
      // FRESH INTRADAY BUY OPPORTUNITY (NO POSITION)
      // ══════════════════════════════════════════════════════════
      const isStrong = action.includes('STRONG');
      entry = currentPrice;
      entryMin = +(currentPrice - validATR * 0.3).toFixed(2);
      entryMax = +(currentPrice + validATR * 0.2).toFixed(2);

      // Structural Support-aware Stop Loss (places stop just below key support level)
      let stopLossVal = +(currentPrice - validATR * 1.5).toFixed(2);
      if (options.srLevels && options.srLevels.support && options.srLevels.support.length > 0) {
        const supBelow = options.srLevels.support.find(s => s < currentPrice && (currentPrice - s) <= validATR * 2.2);
        if (supBelow) {
          stopLossVal = +(supBelow - validATR * 0.25).toFixed(2);
        }
      }
      stopLoss = stopLossVal;

      // Resistance-aware Target 1 (aligns target with actual overhead resistance)
      let target1Val = +(Math.max(currentPrice + validATR * 2.0, (bbUpper + currentPrice) / 2)).toFixed(2);
      if (options.srLevels && options.srLevels.resistance && options.srLevels.resistance.length > 0) {
        const resAbove = options.srLevels.resistance.find(r => r > currentPrice && (r - currentPrice) >= validATR * 1.2);
        if (resAbove) {
          target1Val = +resAbove.toFixed(2);
        }
      }
      target1 = target1Val;
      target2 = +(Math.max(target1 + validATR * 1.2, currentPrice + validATR * 3.5)).toFixed(2);

      const risk = Math.max(0.1, entry - stopLoss);
      const reward = Math.max(0.1, target1 - entry);
      riskReward = (reward / risk).toFixed(1);

      const riskPct = (((stopLoss - entry) / entry) * 100).toFixed(2);
      const target1Pct = (((target1 - entry) / entry) * 100).toFixed(2);
      const target2Pct = (((target2 - entry) / entry) * 100).toFixed(2);

      actionHeadline = isStrong
        ? `BUY STOCK NOW — High conviction bullish confluence at ₹${entry.toFixed(2)}`
        : `BUY STOCK ON PULLBACK — Accumulate between ₹${entryMin.toFixed(2)} - ₹${entryMax.toFixed(2)}`;

      timingAdvice = isStrong
        ? `Enter at market or limit around ₹${entry.toFixed(2)}. Technical indicators and volume confirm upside probability.`
        : `Place limit order between ₹${entryMin.toFixed(2)} and ₹${entry.toFixed(2)}. Wait for slight dip to maximize risk-reward.`;

      checklist = [
        {
          type: 'enter',
          label: 'WHEN TO BUY (ENTRY)',
          text: `Buy stock around **₹${entry.toFixed(2)}** (Optimal Zone: ₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}).`,
        },
        {
          type: 'target',
          label: 'WHEN TO EXIT BUY (PROFIT TARGET)',
          text: `Exit 50% at **Target 1 (₹${target1.toFixed(2)} / +${target1Pct}%)**. Move stop to entry and target **₹${target2.toFixed(2)} (+${target2Pct}%)**.`,
        },
        {
          type: 'exit',
          label: 'WHEN TO EXIT BUY (STOP LOSS)',
          text: `Exit 100% immediately if candle drops below **Stop Loss (₹${stopLoss.toFixed(2)} / ${riskPct}%)** to cap downside.`,
        },
        {
          type: 'exit',
          label: 'INTRADAY EXIT RULE',
          text: `Exit position on confirmed bearish reversal or mandatory end-of-session square-off at **15:15 IST**.`,
        },
      ];

      return {
        hasSetup: true,
        positionStatus: 'NO_POSITION',
        boughtPrice: null,
        currentPrice,
        pnl: null,
        pnlPct: null,
        type: 'BUY STOCK',
        actionHeadline,
        timingAdvice,
        entryPrice: entry,
        entryZone: `₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}`,
        stopLoss,
        stopLossPct: `${riskPct}%`,
        target1,
        target1Pct: `+${target1Pct}%`,
        target2,
        target2Pct: `+${target2Pct}%`,
        riskReward: `1 : ${riskReward}`,
        timeHorizon: isIntraday ? 'Intraday (Same Day)' : '1 – 5 Days (Swing)',
        exitReason: null,
        checklist,
      };

    } else if (isSellSignal) {
      // ══════════════════════════════════════════════════════════
      // FRESH BEARISH / SELL / SHORT OPPORTUNITY (NO POSITION)
      // ══════════════════════════════════════════════════════════
      const isStrong = action.includes('STRONG');
      entry = currentPrice;
      entryMin = +(currentPrice - validATR * 0.2).toFixed(2);
      entryMax = +(currentPrice + validATR * 0.3).toFixed(2);

      // Structural Resistance-aware Stop Loss (places stop just above overhead resistance)
      let stopLossVal = +(currentPrice + validATR * 1.5).toFixed(2);
      if (options.srLevels && options.srLevels.resistance && options.srLevels.resistance.length > 0) {
        const resAbove = options.srLevels.resistance.find(r => r > currentPrice && (r - currentPrice) <= validATR * 2.2);
        if (resAbove) {
          stopLossVal = +(resAbove + validATR * 0.25).toFixed(2);
        }
      }
      stopLoss = stopLossVal;

      // Support-aware Target 1 (aligns target with actual underlying support)
      let target1Val = +(Math.min(currentPrice - validATR * 2.0, (bbLower + currentPrice) / 2)).toFixed(2);
      if (options.srLevels && options.srLevels.support && options.srLevels.support.length > 0) {
        const supBelow = options.srLevels.support.find(s => s < currentPrice && (currentPrice - s) >= validATR * 1.2);
        if (supBelow) {
          target1Val = +supBelow.toFixed(2);
        }
      }
      target1 = target1Val;
      target2 = +(Math.min(target1 - validATR * 1.2, currentPrice - validATR * 3.5)).toFixed(2);

      const risk = Math.max(0.1, stopLoss - entry);
      const reward = Math.max(0.1, entry - target1);
      riskReward = (reward / risk).toFixed(1);

      const riskPct = (((stopLoss - entry) / entry) * 100).toFixed(2);
      const target1Pct = (((target1 - entry) / entry) * 100).toFixed(2);
      const target2Pct = (((target2 - entry) / entry) * 100).toFixed(2);

      actionHeadline = isStrong
        ? `SELL / SHORT NOW — Bearish breakdown confluence at ₹${entry.toFixed(2)}`
        : `SELL ON RALLY — Short entry zone ₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}`;

      timingAdvice = isStrong
        ? `Bearish pressure confirmed by multi-indicator breakdown. Exit long or initiate short. Exit Cover Target is ₹${target1.toFixed(2)} (${target1Pct}%).`
        : `Place sell order near ₹${entry.toFixed(2)}. Stop Loss at ₹${stopLoss.toFixed(2)} (+${riskPct}%).`;

      checklist = [
        {
          type: 'exit',
          label: 'WHEN TO SELL (ENTRY)',
          text: `Sell / Short around **₹${entry.toFixed(2)}** (Optimal Zone: ₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}).`,
        },
        {
          type: 'target',
          label: 'WHEN TO EXIT SELL (COVER TARGET)',
          text: `Cover 50% at **Target 1 (₹${target1.toFixed(2)} / ${target1Pct}%)**. Move stop to entry and cover remaining at **Target 2 (₹${target2.toFixed(2)} / ${target2Pct}%)**.`,
        },
        {
          type: 'exit',
          label: 'WHEN TO EXIT SELL (STOP LOSS)',
          text: `Cover 100% immediately if price crosses above **Stop Loss (₹${stopLoss.toFixed(2)} / +${riskPct}%)** to cap upside risk.`,
        },
        {
          type: 'exit',
          label: 'INTRADAY EXIT RULE',
          text: `Mandatory square-off by **15:15 IST** or upon bullish reversal signal.`,
        },
      ];

      return {
        hasSetup: true,
        positionStatus: 'NO_POSITION',
        boughtPrice: null,
        currentPrice,
        pnl: null,
        pnlPct: null,
        type: 'SELL STOCK',
        actionHeadline,
        timingAdvice,
        entryPrice: entry,
        entryZone: `₹${entryMin.toFixed(2)} – ₹${entryMax.toFixed(2)}`,
        stopLoss,
        stopLossPct: `+${riskPct}%`,
        target1,
        target1Pct: `${target1Pct}%`,
        target2,
        target2Pct: `${target2Pct}%`,
        riskReward: `1 : ${riskReward}`,
        timeHorizon: isIntraday ? 'Intraday (Same Day)' : '1 – 5 Days (Swing)',
        exitReason: null,
        checklist,
      };

    } else {
      // ══════════════════════════════════════════════════════════
      // CONSOLIDATION / NO CLEAR SIGNAL
      // ══════════════════════════════════════════════════════════
      const breakoutBuy = +(currentPrice + validATR * 1.2).toFixed(2);
      const breakdownSell = +(currentPrice - validATR * 1.2).toFixed(2);

      actionHeadline = `WAIT FOR CONFIRMATION — Consolidation at ₹${currentPrice.toFixed(2)}`;
      timingAdvice = `No clear intraday edge right now. Wait for confirmed breakout above ₹${breakoutBuy.toFixed(2)} before initiating new buys.`;

      checklist = [
        {
          type: 'wait',
          label: 'WHEN TO BUY (TRIGGER)',
          text: `Buy only if a candle closes above **₹${breakoutBuy.toFixed(2)}** with confirmed volume surge.`,
        },
        {
          type: 'wait',
          label: 'SUPPORT WATCH',
          text: `Key support is at **₹${breakdownSell.toFixed(2)}**. Breakdown below indicates further weakness.`,
        },
        {
          type: 'hold',
          label: 'CAPITAL DISCIPLINE',
          text: `Preserve capital in cash. High win-rate trading requires patience for confirmed setups.`,
        },
      ];

      return {
        hasSetup: false,
        positionStatus: 'NO_POSITION',
        boughtPrice: null,
        currentPrice,
        pnl: null,
        pnlPct: null,
        type: 'WAIT FOR CONFIRMATION',
        actionHeadline,
        timingAdvice,
        entryPrice: currentPrice,
        entryZone: `Consolidation (₹${breakdownSell.toFixed(2)} – ₹${breakoutBuy.toFixed(2)})`,
        stopLoss: breakdownSell,
        stopLossPct: `${(((breakdownSell - currentPrice) / currentPrice) * 100).toFixed(1)}%`,
        target1: breakoutBuy,
        target1Pct: `+${(((breakoutBuy - currentPrice) / currentPrice) * 100).toFixed(1)}%`,
        target2: +(breakoutBuy + validATR).toFixed(2),
        target2Pct: `+${((((breakoutBuy + validATR) - currentPrice) / currentPrice) * 100).toFixed(1)}%`,
        riskReward: 'N/A',
        timeHorizon: 'Wait for Setup',
        exitReason: null,
        checklist,
      };
    }
  }

  /**
   * Run Authentic Historical Backtest based on simulated trade lifecycle
   */
  /**
   * Run Authentic Historical Backtest with Realistic Slippage
   * Slippage: 0.05% per side (entry and exit) to reflect real market execution
   */
  function runBacktest(trades, candles) {
    if (!trades || trades.length === 0) {
      return {
        totalSignals: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profitFactor: '—',
        avgWinPct: '—',
        avgLossPct: '—',
        expectedValue: '—',
        recentTrades: [],
      };
    }

    const SLIPPAGE_PCT = 0.05; // 0.05% per side (entry + exit)

    // Recompute PnL with slippage for realistic accuracy
    const adjustedTrades = trades.map(t => {
      const adjEntry = t.entryPrice * (1 + SLIPPAGE_PCT / 100);
      const adjExit = t.exitPrice * (1 - SLIPPAGE_PCT / 100);
      const adjPnl = adjExit - adjEntry;
      const adjPnlPct = +((adjPnl / adjEntry) * 100).toFixed(2);
      return { ...t, pnlPct: adjPnlPct, pnl: +adjPnl.toFixed(2), outcome: adjPnl >= 0 ? 'WIN' : 'LOSS' };
    });

    const wins = adjustedTrades.filter(t => t.outcome === 'WIN');
    const losses = adjustedTrades.filter(t => t.outcome === 'LOSS');
    const totalSignals = adjustedTrades.length;

    const winRate = +( (wins.length / totalSignals) * 100 ).toFixed(1);
    const totalWinPnl = wins.reduce((sum, t) => sum + Math.abs(t.pnlPct || 0), 0);
    const totalLossPnl = losses.reduce((sum, t) => sum + Math.abs(t.pnlPct || 0), 0);

    const avgWin = wins.length > 0 ? (totalWinPnl / wins.length) : 0;
    const avgLoss = losses.length > 0 ? (totalLossPnl / losses.length) : 0;
    const profitFactor = totalLossPnl > 0 ? +(totalWinPnl / totalLossPnl).toFixed(2) : (totalWinPnl > 0 ? 'Max' : '0.00');

    const ev = +( ((winRate / 100) * avgWin) - (((100 - winRate) / 100) * avgLoss) ).toFixed(2);

    return {
      totalSignals,
      wins: wins.length,
      losses: losses.length,
      winRate,
      profitFactor,
      avgWinPct: `+${avgWin.toFixed(2)}%`,
      avgLossPct: `-${avgLoss.toFixed(2)}%`,
      expectedValue: `${ev >= 0 ? '+' : ''}${ev}%`,
      recentTrades: adjustedTrades.slice(-8).reverse(),
    };
  }

  /**
   * Compute 5-Bar Forward Price Forecast & Statistical Confidence Cones
   */
  /**
   * Compute 5-Bar Forward Price Forecast with Mean-Reversion & Structural Levels
   * Uses Bollinger Band midline pull, S/R proximity, and confidence-weighted cones
   */
  function computeForecast(currentPrice, atr, signal, confidence, trend, context = {}) {
    const validATR = (atr && atr > 0) ? atr : (currentPrice * 0.015);
    const isBull = signal.includes('BUY');
    const isBear = signal.includes('SELL') || signal.includes('NO BUY');

    // Mean-reversion component: pull toward SMA20 / BB midline
    const bbMid = context.sma20Value || currentPrice;
    const distFromMid = (currentPrice - bbMid);
    const meanReversionPerBar = distFromMid !== 0 ? -(distFromMid * 0.08) : 0;

    // Momentum drift based on signal
    const momentumDrift = isBull ? 0.28 : isBear ? -0.28 : 0.03;

    // S/R magnet effect: price tends to gravitate toward nearest S/R
    let srPull = 0;
    if (context.srLevels) {
      const nearestRes = context.srLevels.resistance && context.srLevels.resistance[0];
      const nearestSup = context.srLevels.support && context.srLevels.support[0];
      if (isBull && nearestRes && nearestRes > currentPrice) {
        const distToRes = nearestRes - currentPrice;
        srPull = Math.min(distToRes * 0.1, validATR * 0.3);
      } else if (isBear && nearestSup && nearestSup < currentPrice) {
        const distToSup = currentPrice - nearestSup;
        srPull = -Math.min(distToSup * 0.1, validATR * 0.3);
      }
    }

    const bars = [];
    // Confidence-based cone tightening: higher confidence = tighter prediction band
    const coneFactor = Math.max(0.5, 1.0 - (confidence / 250));

    for (let bar = 1; bar <= 5; bar++) {
      const momentum = bar * validATR * momentumDrift;
      const meanRev = bar * meanReversionPerBar;
      const sr = srPull * Math.min(bar, 3) / 3;
      const drift = momentum + meanRev * 0.4 + sr;
      const sigma = Math.sqrt(bar) * validATR * 0.85 * coneFactor;

      const expected = +(currentPrice + drift).toFixed(2);
      const upper90 = +(currentPrice + drift + sigma * 1.64).toFixed(2);
      const lower90 = +(currentPrice + drift - sigma * 1.64).toFixed(2);
      const deltaPct = (((expected - currentPrice) / currentPrice) * 100).toFixed(2);

      bars.push({
        bar: `Bar +${bar}`,
        expected,
        upper90,
        lower90,
        deltaPct: `${deltaPct >= 0 ? '+' : ''}${deltaPct}%`,
      });
    }

    const upsideProb = isBull ? Math.min(88, 50 + confidence * 0.4) : isBear ? Math.max(15, 50 - confidence * 0.4) : 50;

    return {
      upsideProbability: `${Math.round(upsideProb)}%`,
      downsideProbability: `${Math.round(100 - upsideProb)}%`,
      target1Bar: bars[0].expected,
      target3Bar: bars[2].expected,
      target5Bar: bars[4].expected,
      bars,
      trajectory: bars,
    };
  }

  /**
   * Compute Algorithmic Confluence Matrix (Multi-Factor Scoring)
   */
  function computeConfluenceMatrix(totalScore, rsiResult, macdScore, maScore, patternScore, volumeScore, divScore, srScore) {
    const absScore = Math.abs(totalScore);
    let grade = 'A+';
    let quality = 'High Confluence';

    if (absScore >= 65) { grade = 'A+'; quality = 'High Conviction Setup'; }
    else if (absScore >= 45) { grade = 'A'; quality = 'High Conviction'; }
    else if (absScore >= 25) { grade = 'B+'; quality = 'Moderate Confluence'; }
    else { grade = 'C'; quality = 'Low Edge / Neutral'; }

    return {
      grade,
      quality,
      factors: [
        { name: 'Momentum & MACD', score: Math.round(Math.abs(macdScore.score || 0)), weight: '18%' },
        { name: 'Candlestick Patterns', score: Math.round(Math.abs(patternScore.score || 0)), weight: '17%' },
        { name: 'Volume & Accumulation', score: Math.round(Math.abs(volumeScore.score || 0)), weight: '15%' },
        { name: 'RSI Divergence', score: Math.round(Math.abs((divScore && divScore.score) || 0)), weight: '13%' },
        { name: 'Trend Alignment (MAs)', score: Math.round(Math.abs(maScore.score || 0)), weight: '13%' },
        { name: 'RSI Oscillator', score: Math.round(Math.abs(rsiResult.score || 0)), weight: '12%' },
        { name: 'Support / Resistance', score: Math.round(Math.abs((srScore && srScore.score) || 0)), weight: '12%' },
      ],
    };
  }

  /**
   * Determine overall trend from moving averages and price action
   */
  /**
   * Determine overall trend from moving averages, price action, and ADX strength
   * ADX < 20 forces sideways classification regardless of MA alignment
   */
  function detectTrend(candles, sma20, sma50, ema12, ema26, currentADX) {
    const lastIdx = candles.length - 1;
    let bullishPoints = 0;
    let bearishPoints = 0;

    if (sma20 && sma20[lastIdx] != null) {
      if (candles[lastIdx].close > sma20[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    if (sma50 && sma50[lastIdx] != null) {
      if (candles[lastIdx].close > sma50[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    if (sma20 && sma50 && sma20[lastIdx] != null && sma50[lastIdx] != null) {
      if (sma20[lastIdx] > sma50[lastIdx]) bullishPoints += 3;
      else bearishPoints += 3;
    }

    if (ema12 && ema26 && ema12[lastIdx] != null && ema26[lastIdx] != null) {
      if (ema12[lastIdx] > ema26[lastIdx]) bullishPoints += 2;
      else bearishPoints += 2;
    }

    const recent = candles.slice(-10);
    const firstClose = recent[0].close;
    const lastClose = recent[recent.length - 1].close;
    const recentChange = (lastClose - firstClose) / firstClose;

    if (recentChange > 0.02) bullishPoints += 3;
    else if (recentChange < -0.02) bearishPoints += 3;

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

    // ADX override: if ADX < 20, there is no meaningful trend regardless of MA alignment
    if (currentADX != null && currentADX < 20) {
      direction = 'sideways';
      strength = 'weak';
      return { direction, strength };
    }

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
  /**
   * Score RSI signal — Full range coverage (no dead zones)
   * Every RSI value now contributes to the decision
   */
  function scoreRSI(rsi) {
    if (rsi == null) return { score: 0, reason: null };

    if (rsi >= 85) return { score: -90, reason: `**RSI at ${rsi.toFixed(1)}** — Extreme overbought. Strong reversal/selling pressure expected.` };
    if (rsi >= 80) return { score: -75, reason: `**RSI at ${rsi.toFixed(1)}** — Extremely overbought. Strong selling pressure expected.` };
    if (rsi >= 75) return { score: -55, reason: `**RSI at ${rsi.toFixed(1)}** — Overbought zone. Pullback increasingly likely.` };
    if (rsi >= 70) return { score: -40, reason: `**RSI at ${rsi.toFixed(1)}** — Overbought territory. Price may be extended.` };
    if (rsi >= 65) return { score: -10, reason: `**RSI at ${rsi.toFixed(1)}** — Approaching overbought. Momentum fading slightly.` };
    if (rsi >= 60) return { score: 15, reason: `**RSI at ${rsi.toFixed(1)}** — Strong bullish momentum zone.` };
    if (rsi > 55)  return { score: 25, reason: `**RSI at ${rsi.toFixed(1)}** — Healthy bullish momentum.` };
    if (rsi > 50)  return { score: 20, reason: `**RSI at ${rsi.toFixed(1)}** — Bullish momentum.` };
    if (rsi > 45)  return { score: -10, reason: `**RSI at ${rsi.toFixed(1)}** — Neutral to weak bearish drift.` };
    if (rsi > 40)  return { score: -20, reason: `**RSI at ${rsi.toFixed(1)}** — Bearish drift.` };
    if (rsi > 35)  return { score: -35, reason: `**RSI at ${rsi.toFixed(1)}** — Approaching oversold. Sellers in control.` };
    if (rsi > 30)  return { score: 30, reason: `**RSI at ${rsi.toFixed(1)}** — Nearing oversold. Bounce potential building.` };
    if (rsi > 20)  return { score: 55, reason: `**RSI at ${rsi.toFixed(1)}** — Oversold territory. Buyers likely to step in.` };
    return { score: 85, reason: `**RSI at ${rsi.toFixed(1)}** — Extremely oversold. Strong bounce expected.` };
  }

  /**
   * Score MACD signal
   */
  /**
   * Score MACD signal — Now includes histogram momentum direction (accelerating/decelerating)
   */
  function scoreMACD(macdVal, signalVal, histogram, fullMacd) {
    if (macdVal == null || signalVal == null) return { score: 0, reason: null };

    let score = 0;
    let reason = '';

    if (macdVal > signalVal) {
      score += 30;
      reason = '**MACD** is above signal line — bullish momentum.';
    } else {
      score -= 30;
      reason = '**MACD** is below signal line — bearish momentum.';
    }

    if (fullMacd && fullMacd.histogram) {
      const hist = fullMacd.histogram;
      const recentHist = hist.slice(-4).filter(v => v != null);
      if (recentHist.length >= 2) {
        const prev = recentHist[recentHist.length - 2];
        const curr = recentHist[recentHist.length - 1];
        if (prev < 0 && curr > 0) {
          score += 40;
          reason = '**MACD Bullish Crossover** — MACD crossed above signal line.';
        } else if (prev > 0 && curr < 0) {
          score -= 40;
          reason = '**MACD Bearish Crossover** — MACD crossed below signal line.';
        }
      }

      // Histogram Momentum Direction: Are bars getting taller or shorter?
      if (recentHist.length >= 3) {
        const h1 = recentHist[recentHist.length - 3];
        const h2 = recentHist[recentHist.length - 2];
        const h3 = recentHist[recentHist.length - 1];

        const isAccelerating = Math.abs(h3) > Math.abs(h2) && Math.abs(h2) > Math.abs(h1);
        const isDecelerating = Math.abs(h3) < Math.abs(h2) && Math.abs(h2) < Math.abs(h1);

        if (isAccelerating && h3 > 0) {
          score += 15;
          reason = '**MACD Accelerating Bullish** — Histogram bars growing. Strong momentum building.';
        } else if (isAccelerating && h3 < 0) {
          score -= 15;
          reason = '**MACD Accelerating Bearish** — Histogram bars deepening. Selling pressure intensifying.';
        } else if (isDecelerating && h3 > 0) {
          score -= 10;
          reason = '**MACD Weakening Bullish** — Histogram bars shrinking. Momentum fading.';
        } else if (isDecelerating && h3 < 0) {
          score += 10;
          reason = '**MACD Weakening Bearish** — Selling pressure easing. Potential bottom forming.';
        }
      }
    }

    if (histogram > 0 && macdVal > 0) score += 10;
    else if (histogram < 0 && macdVal < 0) score -= 10;

    return { score: Math.max(-100, Math.min(100, score)), reason };
  }

  /**
   * Score moving average alignment
   */
  /**
   * Score Moving Average alignment — Now includes EMA12/26 cross detection
   */
  function scoreMovingAverages(price, sma20, sma50, ema12, ema26, candles) {
    let score = 0;
    const reasons = [];
    const lastIdx = candles.length - 1;

    if (sma20 != null) {
      if (price > sma20) { score += 15; }
      else { score -= 15; }
    }

    if (sma50 != null) {
      if (price > sma50) { score += 15; }
      else { score -= 15; }
    }

    if (sma20 != null && sma50 != null) {
      if (sma20 > sma50) {
        score += 20;
        reasons.push('**Golden Cross** — SMA(20) above SMA(50) indicates bullish structure.');
      } else {
        score -= 20;
        reasons.push('**Death Cross** — SMA(20) below SMA(50) indicates bearish structure.');
      }
    }

    // EMA 12/26 Cross Detection (faster signal for intraday)
    if (ema12 && ema26 && ema12[lastIdx] != null && ema26[lastIdx] != null) {
      if (ema12[lastIdx] > ema26[lastIdx]) {
        score += 12;
        // Check for FRESH cross (previous bar EMA12 was below EMA26)
        if (lastIdx > 0 && ema12[lastIdx - 1] != null && ema26[lastIdx - 1] != null &&
            ema12[lastIdx - 1] <= ema26[lastIdx - 1]) {
          score += 20;
          reasons.push('**Fresh EMA Bullish Cross** — EMA(12) just crossed above EMA(26). High-value entry signal.');
        }
      } else {
        score -= 12;
        if (lastIdx > 0 && ema12[lastIdx - 1] != null && ema26[lastIdx - 1] != null &&
            ema12[lastIdx - 1] >= ema26[lastIdx - 1]) {
          score -= 20;
          reasons.push('**Fresh EMA Bearish Cross** — EMA(12) just crossed below EMA(26). Exit signal.');
        }
      }
    }

    return {
      score: Math.max(-100, Math.min(100, score)),
      reason: reasons.join(' ') || `Price is ${price > (sma20 || price) ? 'above' : 'below'} key moving averages.`,
    };
  }

  /**
   * Score candlestick patterns
   */
  /**
   * Score Candlestick Patterns — With recency bias (recent patterns matter more)
   * @param {Array} patterns - Detected patterns
   * @param {number} candleCount - Total candle count for recency calculation
   */
  function scorePatterns(patterns, candleCount) {
    if (!patterns || patterns.length === 0) {
      return { score: 0, reason: 'No significant candlestick patterns detected in recent lookback.' };
    }

    let score = 0;
    const patternNames = [];
    const totalBars = candleCount || 100;
    // Take more patterns since we now detect multiple per bar
    const topPatterns = patterns.slice(-8);

    for (const p of topPatterns) {
      const confRatio = typeof p.confidence === 'number' ? (p.confidence / 100) : 0.8;
      // Recency decay: latest bar = 1.0, 20+ bars ago = 0.15
      const barsAgo = totalBars - (p.index || 0);
      const recencyWeight = Math.max(0.15, 1.0 - (barsAgo / 25));
      const weightedConf = confRatio * recencyWeight;

      if (p.signal === 'bullish') {
        score += 30 * weightedConf;
        patternNames.push(p.name);
      } else if (p.signal === 'bearish') {
        score -= 30 * weightedConf;
        patternNames.push(p.name);
      } else {
        patternNames.push(p.name);
      }
    }

    return {
      score: Math.max(-100, Math.min(100, Math.round(score))),
      reason: `**Detected patterns:** ${patternNames.join(', ')}. ${
        score > 0 ? 'Bullish patterns dominate.' : score < 0 ? 'Bearish patterns dominate.' : 'Mixed pattern signals.'
      }`,
    };
  }

  /**
   * Score volume (trend confirmation)
   */
  /**
   * Score Volume — Comprehensive analysis with accumulation/distribution, volume climax,
   * and OBV trend confirmation. Volume is now a major decision factor.
   */
  function scoreVolume(candles, obvValues) {
    if (candles.length < 20) return { score: 0, reason: null };

    const recent5 = candles.slice(-5);
    const prior15 = candles.slice(-20, -5);

    const avgRecentVol = recent5.reduce((s, c) => s + c.volume, 0) / recent5.length;
    const avgPriorVol = prior15.reduce((s, c) => s + c.volume, 0) / prior15.length;

    if (avgPriorVol === 0) return { score: 0, reason: null };

    const volRatio = avgRecentVol / avgPriorVol;
    const recentTrend = recent5[recent5.length - 1].close - recent5[0].close;

    // Accumulation/Distribution: Volume on green vs red candles
    let upVol = 0, downVol = 0;
    for (const c of recent5) {
      if (c.close >= c.open) upVol += (c.volume || 0);
      else downVol += (c.volume || 0);
    }
    const totalVol = upVol + downVol;
    const adRatio = totalVol > 0 ? upVol / totalVol : 0.5;

    // Volume Climax: Latest bar > 2.5x 20-bar average (exhaustion signal)
    const avg20Vol = candles.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20;
    const lastVol = candles[candles.length - 1].volume || 0;
    const isVolumeClimax = lastVol > avg20Vol * 2.5;

    // OBV Trend confirmation (if available)
    let obvConfirms = 0;
    if (obvValues && obvValues.length >= 10) {
      const obvRecent = obvValues[obvValues.length - 1];
      const obv5Ago = obvValues[obvValues.length - 6];
      if (obvRecent > obv5Ago && recentTrend > 0) obvConfirms = 1;   // OBV confirms up
      else if (obvRecent < obv5Ago && recentTrend < 0) obvConfirms = -1; // OBV confirms down
      else if (obvRecent < obv5Ago && recentTrend > 0) obvConfirms = -0.5; // OBV diverges bearish
      else if (obvRecent > obv5Ago && recentTrend < 0) obvConfirms = 0.5;  // OBV diverges bullish
    }

    let score = 0;
    let reason = '';

    // Volume surge with directional confirmation
    if (volRatio > 1.5 && adRatio > 0.60) {
      score += 55;
      reason = `**Volume surge (+${Math.round((volRatio - 1) * 100)}%)** with ${Math.round(adRatio * 100)}% accumulation confirms strong buying.`;
    } else if (volRatio > 1.5 && adRatio < 0.40) {
      score -= 55;
      reason = `**Volume surge (+${Math.round((volRatio - 1) * 100)}%)** with ${Math.round((1 - adRatio) * 100)}% distribution confirms selling pressure.`;
    } else if (volRatio > 1.2 && recentTrend > 0) {
      score += 25;
      reason = `**Rising volume (+${Math.round((volRatio - 1) * 100)}%)** supports upward price movement.`;
    } else if (volRatio > 1.2 && recentTrend < 0) {
      score -= 25;
      reason = `**Rising volume (+${Math.round((volRatio - 1) * 100)}%)** confirms downward pressure.`;
    } else if (volRatio < 0.5) {
      score -= 5;
      reason = 'Declining volume suggests consolidation — breakout lacks conviction.';
    }

    // Volume climax bonus/penalty
    if (isVolumeClimax) {
      score += (adRatio > 0.55 ? 15 : -15);
    }

    // OBV confirmation bonus
    score += Math.round(obvConfirms * 15);

    return { score: Math.max(-100, Math.min(100, score)), reason: reason || null };
  }

  /**
   * Score RSI Divergence (NEW) — High-reliability reversal signal
   * Bullish divergence: +60 to +85 | Bearish divergence: -60 to -85
   */
  function scoreDivergence(divergence) {
    if (!divergence) return { score: 0, reason: null };

    if (divergence.type === 'bullish') {
      const score = Math.min(85, 60 + Math.round((divergence.strength || 70) * 0.25));
      return {
        score,
        reason: `🔄 **Bullish RSI Divergence** — Price made lower low but RSI made higher low. Reversal UP expected (~80% reliability).`,
      };
    }
    if (divergence.type === 'bearish') {
      const score = -Math.min(85, 60 + Math.round((divergence.strength || 70) * 0.25));
      return {
        score,
        reason: `🔄 **Bearish RSI Divergence** — Price made higher high but RSI made lower high. Reversal DOWN expected (~80% reliability).`,
      };
    }
    return { score: 0, reason: null };
  }

  /**
   * Score Support / Resistance Context (NEW)
   * BUY near support = bonus | BUY near resistance = penalty
   */
  function scoreSupportResistance(price, srLevels, atr, trend) {
    if (!srLevels) return { score: 0, reason: null };

    const validATR = (atr && atr > 0) ? atr : price * 0.015;
    let score = 0;
    let reason = '';

    // Check proximity to support levels (within 1.2% or 0.5 ATR)
    const nearSupport = srLevels.support && srLevels.support.some(s => {
      const dist = Math.abs(price - s);
      return dist / price < 0.012 || dist < validATR * 0.5;
    });

    // Check proximity to resistance levels
    const nearResistance = srLevels.resistance && srLevels.resistance.some(r => {
      const dist = Math.abs(price - r);
      return dist / price < 0.012 || dist < validATR * 0.5;
    });

    if (nearSupport && (trend.direction === 'uptrend' || trend.direction === 'sideways')) {
      score += 40;
      reason = `✅ Price at **support zone (₹${srLevels.support[0]?.toFixed(2) || '—'})** — Favorable entry with defined risk.`;
    } else if (nearSupport && trend.direction === 'downtrend') {
      score += 15;
      reason = `⚠️ Price at **support (₹${srLevels.support[0]?.toFixed(2) || '—'})** in downtrend — May bounce but trend is against.`;
    }

    if (nearResistance) {
      score -= 40;
      reason = `🚫 Price at **resistance zone (₹${srLevels.resistance[0]?.toFixed(2) || '—'})** — High risk of rejection. Wait for breakout confirmation.`;
    }

    return { score: Math.max(-100, Math.min(100, score)), reason: reason || null };
  }

  /**
   * Build a human-readable summary paragraph
   */
  function buildSummary(prediction) {
    const { signal, confidence, trend, reasons, positionState, tradeSetup } = prediction;
    const filteredReasons = (reasons || []).filter(Boolean);

    let summary = '';
    if (positionState === 'OPEN_LONG') {
      summary = `Intraday Position is **OPEN** (Entry: ₹${tradeSetup.entryPrice ? tradeSetup.entryPrice.toFixed(2) : '—'}). Current directive is **${signal}**. `;
    } else if (signal && signal.includes('BUY')) {
      summary = `The technical analysis indicates a **bullish outlook (BUY STOCK)** with ${confidence}% confluence confidence. `;
    } else if (signal && signal.includes('SELL')) {
      summary = `The technical analysis indicates a **bearish outlook (SELL / EXIT)** with ${confidence}% confidence. `;
    } else {
      summary = `The market is showing **consolidation (WAIT / HOLD)**. `;
    }

    summary += `Current trend structure is **${trend}**. `;

    if (filteredReasons.length > 0) {
      summary += filteredReasons[0];
    }

    return summary;
  }

  return {
    analyze,
    buildSummary,
    runTradeLifecycle,
    getIntradaySessionInfo,
    getCandleISTTime,
  };
})();

const PredictionEngine = Predictions;
if (typeof window !== 'undefined') {
  window.PredictionEngine = Predictions;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Predictions;
  module.exports.Predictions = Predictions;
  module.exports.PredictionEngine = Predictions;
}

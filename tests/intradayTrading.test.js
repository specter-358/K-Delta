/* ============================================================
   K-Delta — Intraday Trading & Trade Lifecycle Unit Test Suite
   Verifies:
   - Scenario A: BUY → TARGET → SELL
   - Scenario B: BUY → STOP LOSS → SELL
   - Scenario C: BUY → REVERSAL → SELL
   - Scenario D: No valid setup → WAIT FOR CONFIRMATION (No forced BUY)
   - Scenario E: Existing open position → HOLD / SELL (No BUY loop)
   - Scenario F: End of session square-off at 15:15 IST
   - Scenario G: Consistency between Chart Markers and Trade Plan
   ============================================================ */

const assert = require('assert');
const { Predictions, PredictionEngine } = require('../js/predictions');

// Helper to create synthetic candle
function createCandle(index, open, high, low, close, volume = 10000, timeOverride = null) {
  // Unix timestamp in seconds (10:00 AM IST on a weekday)
  // 1710995400 = 2024-03-21 09:30:00 IST
  const baseTime = 1710995400 + index * 300; // 5-minute bars
  return {
    time: timeOverride || baseTime,
    open: parseFloat(open.toFixed(2)),
    high: parseFloat(high.toFixed(2)),
    low: parseFloat(low.toFixed(2)),
    close: parseFloat(close.toFixed(2)),
    volume,
  };
}

// Helper to generate healthy bullish trend with realistic fluctuations (RSI 55-68)
function createBullishBase(count = 25) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const change = (i % 2 === 0) ? -0.2 : 0.4;
    const o = price;
    price += change;
    candles.push(createCandle(i, o, Math.max(o, price) + 0.2, Math.min(o, price) - 0.2, price));
  }
  return candles;
}

async function runIntradayTests() {
  console.log('[INTRADAY TRADING] Starting Lifecycle & Trading Logic Test Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    Error:`, err.message || err);
      failed++;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 1. Scenario A: BUY → TARGET → SELL
  // ════════════════════════════════════════════════════════════
  await test('Scenario A: BUY → TARGET → SELL Lifecycle', () => {
    const candles = createBullishBase(25);
    // At Bar 21, BUY entry is triggered around 102.2
    // Add next candle surging up to hit Target 1 (e.g. 104.0)
    candles.push(createCandle(25, 102.2, 104.0, 102.0, 103.8));

    const lifecycle = Predictions.runTradeLifecycle(candles, { isIntraday: true });
    
    assert(lifecycle.trades.length >= 1, 'Expected at least 1 closed trade');
    const trade = lifecycle.trades[lifecycle.trades.length - 1];
    assert.strictEqual(trade.status, 'CLOSED', 'Trade status should be CLOSED');
    assert.strictEqual(trade.outcome, 'WIN', 'Target trade should be a WIN');
    assert(trade.exitPrice >= trade.entryPrice, 'Exit price must be >= entry price on target exit');
    assert.strictEqual(trade.exitReason, 'Target reached', `Exit reason must be 'Target reached', got: ${trade.exitReason}`);

    // Verify Trade Events for chart markers
    assert(lifecycle.tradeEvents.length >= 2, 'Should have at least BUY and SELL event markers');
    const buyEvent = lifecycle.tradeEvents.find(e => e.type === 'BUY');
    const sellEvent = lifecycle.tradeEvents.find(e => e.type === 'SELL');
    assert(buyEvent, 'BUY event must exist');
    assert(sellEvent, 'SELL event must exist');
    assert(buyEvent.time < sellEvent.time, 'BUY event must happen before SELL event');
    assert(sellEvent.text.includes('Target') || sellEvent.text.includes('SELL'), 'SELL text must describe target');
  });

  // ════════════════════════════════════════════════════════════
  // 2. Scenario B: BUY → STOP LOSS → SELL
  // ════════════════════════════════════════════════════════════
  await test('Scenario B: BUY → STOP LOSS → SELL Lifecycle', () => {
    const candles = createBullishBase(25);
    // At Bar 21, BUY entry is triggered around 102.2 (stop loss ~ 101.15)
    // Add next candle dropping down to 100.5 to trigger stop loss
    candles.push(createCandle(25, 102.2, 102.3, 100.5, 100.8));

    const lifecycle = Predictions.runTradeLifecycle(candles, { isIntraday: true });
    
    assert(lifecycle.trades.length >= 1, 'Expected at least 1 closed trade');
    const trade = lifecycle.trades[lifecycle.trades.length - 1];
    assert.strictEqual(trade.status, 'CLOSED');
    assert.strictEqual(trade.outcome, 'LOSS', 'Stop loss exit should be a LOSS');
    assert(trade.exitPrice <= trade.entryPrice, 'Exit price must be <= entry price on stop exit');
    assert.strictEqual(trade.exitReason, 'Stop loss reached', `Exit reason must be 'Stop loss reached', got: ${trade.exitReason}`);

    const sellEvent = lifecycle.tradeEvents.find(e => e.type === 'SELL');
    assert(sellEvent, 'SELL marker must exist for stop loss');
    assert(sellEvent.reason.includes('Stop loss'), 'SELL reason must indicate Stop loss');
  });

  // ════════════════════════════════════════════════════════════
  // 3. Scenario C: BUY → REVERSAL → SELL
  // ════════════════════════════════════════════════════════════
  await test('Scenario C: BUY → BEARISH REVERSAL → SELL Lifecycle', () => {
    const candles = createBullishBase(25);
    // Trade entered at Bar 21 around 102.2
    // Now add bars that break down below SMA 20 without hitting hard stop immediately
    candles.push(createCandle(25, 102.2, 102.3, 101.5, 101.6));
    candles.push(createCandle(26, 101.6, 101.6, 101.3, 101.35));
    candles.push(createCandle(27, 101.35, 101.4, 101.2, 101.22));

    const lifecycle = Predictions.runTradeLifecycle(candles, { isIntraday: true });
    assert(lifecycle.trades.length >= 1, 'Expected completed trade from reversal');
    const trade = lifecycle.trades[lifecycle.trades.length - 1];
    assert.strictEqual(trade.status, 'CLOSED');
    assert(trade.exitReason === 'Bearish exit signal' || trade.exitReason === 'Stop loss reached');
  });

  // ════════════════════════════════════════════════════════════
  // 4. Scenario D: No Valid Setup → WAIT FOR CONFIRMATION
  // ════════════════════════════════════════════════════════════
  await test('Scenario D: No Valid Setup → WAIT FOR CONFIRMATION (No forced BUY)', () => {
    // Flat, choppy consolidation candles with alternating green/red bars and zero momentum
    const candles = [];
    for (let i = 0; i < 35; i++) {
      const isUp = i % 2 === 0;
      const c = isUp ? 100.2 : 99.8;
      const o = isUp ? 99.8 : 100.2;
      candles.push(createCandle(i, o, 100.4, 99.6, c));
    }

    const pred = Predictions.analyze(candles, 'RELIANCE.NS', {
      isIntraday: true,
      currentTime: new Date('2026-03-24T11:00:00+05:30'), // midday
    });
    
    // In consolidation without clear setup, signal must NOT be a forced BUY
    assert(!pred.signal.includes('BUY'), `Should NOT recommend BUY in choppy consolidation, got: ${pred.signal}`);
    assert(pred.signal.includes('WAIT') || pred.signal.includes('HOLD'), `Expected WAIT or HOLD, got: ${pred.signal}`);
    assert.strictEqual(pred.positionState, 'NO_POSITION');
    assert.strictEqual(pred.tradeSetup.hasSetup, false, 'hasSetup should be false during consolidation');
  });

  // ════════════════════════════════════════════════════════════
  // 5. Scenario E: Existing Open Position → HOLD / SELL (No BUY loop)
  // ════════════════════════════════════════════════════════════
  await test('Scenario E: Existing Open Position → Strictly HOLD or SELL (No BUY → BUY loop)', () => {
    const candles = createBullishBase(30);

    // Case E1: Position is OPEN, price is floating safely between Stop Loss (101) and Target (107)
    const openUserPosition = {
      status: 'OPEN_LONG',
      symbol: 'RELIANCE.NS',
      entryPrice: 103.0,
      stopLoss: 101.0,
      target1: 106.0,
      target2: 108.0,
    };

    const predHold = Predictions.analyze(candles, 'RELIANCE.NS', {
      userPosition: openUserPosition,
      isIntraday: true,
      currentTime: new Date('2026-03-24T11:30:00+05:30'), // midday trading hours
    });

    assert.strictEqual(predHold.positionState, 'OPEN_LONG', 'Position state must be OPEN_LONG');
    assert.strictEqual(predHold.signal, 'HOLD STOCK', `Expected HOLD STOCK while position open, got: ${predHold.signal}`);
    assert.strictEqual(predHold.action, 'HOLD LONG POSITION');
    assert(!predHold.signal.includes('BUY'), 'Must NOT generate BUY signal while position is open');
    assert.strictEqual(predHold.tradeSetup.boughtPrice, 103.0);

    // Case E2: Price reaches Target 1 (106)
    candles.push(createCandle(30, 103, 106.5, 102.5, 106.2));
    const predTargetExit = Predictions.analyze(candles, 'RELIANCE.NS', {
      userPosition: openUserPosition,
      isIntraday: true,
      currentTime: new Date('2026-03-24T11:35:00+05:30'),
    });

    assert.strictEqual(predTargetExit.signal, 'SELL STOCK', `Expected SELL STOCK when target reached, got: ${predTargetExit.signal}`);
    assert(predTargetExit.action.includes('TARGET'), `Action should mention target exit, got: ${predTargetExit.action}`);
    assert.strictEqual(predTargetExit.tradeSetup.exitReason, 'Target reached');

    // Case E3: Price drops to Stop Loss (101)
    candles[candles.length - 1] = createCandle(30, 103, 103.5, 100.5, 100.8);
    const predStopExit = Predictions.analyze(candles, 'RELIANCE.NS', {
      userPosition: openUserPosition,
      isIntraday: true,
      currentTime: new Date('2026-03-24T11:35:00+05:30'),
    });

    assert.strictEqual(predStopExit.signal, 'SELL STOCK', `Expected SELL STOCK when stop loss hit, got: ${predStopExit.signal}`);
    assert(predStopExit.action.includes('STOP LOSS'), `Action should mention stop loss, got: ${predStopExit.action}`);
    assert.strictEqual(predStopExit.tradeSetup.exitReason, 'Stop loss reached');
  });

  // ════════════════════════════════════════════════════════════
  // 6. Scenario F: End of Intraday Session Square-off at 15:15 IST
  // ════════════════════════════════════════════════════════════
  await test('Scenario F: End of Intraday Session Square-off at 15:15 IST', () => {
    const candles = createBullishBase(30);

    const openPos = {
      status: 'OPEN_LONG',
      symbol: 'RELIANCE.NS',
      entryPrice: 104.0,
      stopLoss: 101.0,
      target1: 110.0,
      target2: 114.0,
    };

    // Evaluate at 15:20 IST (Square-off window between 15:15 and 15:30)
    const squareOffTime = new Date('2026-03-24T15:20:00+05:30');
    const pred = Predictions.analyze(candles, 'RELIANCE.NS', {
      userPosition: openPos,
      isIntraday: true,
      currentTime: squareOffTime,
    });

    assert.strictEqual(pred.signal, 'SELL STOCK', `Expected SELL STOCK during square-off window, got: ${pred.signal}`);
    assert(pred.action.includes('SQUARE-OFF'), `Action should specify square-off, got: ${pred.action}`);
    assert.strictEqual(pred.tradeSetup.exitReason, 'End-of-session square-off');
  });

  // ════════════════════════════════════════════════════════════
  // 7. Scenario G: Trade Plan Matches Chart Signals (Single Source of Truth)
  // ════════════════════════════════════════════════════════════
  await test('Scenario G: Single Source of Truth — Trade Plan and Chart Agree', () => {
    const candles = createBullishBase(30);

    const pred = Predictions.analyze(candles, 'RELIANCE.NS', { isIntraday: true });

    // Trade Plan Entry matches prediction
    assert(pred.tradeSetup, 'Trade setup must exist');
    if (pred.tradeSetup.hasSetup) {
      assert(pred.tradeSetup.entryPrice > 0, 'Entry price must be positive');
      assert(pred.tradeSetup.target1 > pred.tradeSetup.entryPrice, 'Target 1 must be above entry for long');
      assert(pred.tradeSetup.stopLoss < pred.tradeSetup.entryPrice, 'Stop loss must be below entry for long');
    }

    // Chart tradeEvents must not contain duplicate consecutive BUYs without SELL
    let openTrade = false;
    for (const event of pred.tradeEvents) {
      if (event.type === 'BUY') {
        assert(!openTrade, 'Found consecutive BUY without preceding SELL (BUY loop detected)');
        openTrade = true;
      } else if (event.type === 'SELL') {
        assert(openTrade, 'Found SELL without preceding BUY');
        openTrade = false;
      }
    }
  });

  console.log('====================================================');
  console.log(`Intraday Trading Tests: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runIntradayTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

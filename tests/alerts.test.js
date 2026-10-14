/* ============================================================
   K-Delta — Browser Audio & Price Alert Engine Unit Test Suite
   Verifies: Target breaches (Entry, TP1, TP2, Stop Loss),
   High-Conviction (>80%) setups, Cooldown debounce, Custom alerts
   ============================================================ */

const assert = require('assert');

// Mock browser environment globals for Node.js test runner
global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({
    id: '',
    className: '',
    style: {},
    innerHTML: '',
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {} },
  }),
  getElementById: () => null,
  body: {
    appendChild: () => {},
  },
};
global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; }
};
function MockNotification(title, options) {
  this.title = title;
  this.options = options;
  this.close = () => {};
}
MockNotification.permission = 'granted';
MockNotification.requestPermission = async () => 'granted';
global.Notification = MockNotification;

// Require our modules
const AudioAlerts = require('../js/audioAlerts');
global.AudioAlerts = AudioAlerts;
const AlertEngine = require('../js/alertEngine');

async function runAlertTests() {
  console.log('[ALERTS] Starting K-Delta Alert Engine Test Suite...\n');
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

  // 1. AudioAlerts Module Tests
  await test('AudioAlerts Initialization & Setting Persistence', () => {
    assert.strictEqual(typeof AudioAlerts.play, 'function');
    assert.strictEqual(typeof AudioAlerts.testChime, 'function');
    
    // Toggle mute
    AudioAlerts.setMuted(true);
    assert.strictEqual(AudioAlerts.getSettings().isMuted, true);
    assert.strictEqual(localStorage.getItem('kdelta_audio_muted'), 'true');

    AudioAlerts.setMuted(false);
    assert.strictEqual(AudioAlerts.getSettings().isMuted, false);

    // Set Volume
    AudioAlerts.setVolume(0.85);
    assert.strictEqual(AudioAlerts.getSettings().volume, 0.85);
  });

  // 2. AlertEngine Setup Targets Tracking
  await test('AlertEngine 1-Click Track Setup Targets (Entry, TP1, TP2, Stop)', () => {
    localStorage.clear();
    AlertEngine.init();

    const mockSetup = {
      action: 'BUY STOCK',
      entryPrice: 3000.00,
      entryMin: 2990.00,
      entryMax: 3010.00,
      target1: 3100.00,
      target2: 3200.00,
      stopLoss: 2940.00,
    };

    const count = AlertEngine.trackTradeSetup('RELIANCE.NS', mockSetup, 'Reliance Industries');
    assert.strictEqual(count, 4, 'Should create exactly 4 targets');

    const active = AlertEngine.getActiveAlerts();
    assert.strictEqual(active.length, 4);

    const tp1Alert = active.find(a => a.type === 'target_tp1');
    assert(tp1Alert, 'TP1 alert missing');
    assert.strictEqual(tp1Alert.price, 3100.00);
    assert.strictEqual(tp1Alert.direction, 'above');

    const slAlert = active.find(a => a.type === 'target_sl');
    assert(slAlert, 'SL alert missing');
    assert.strictEqual(slAlert.price, 2940.00);
    assert.strictEqual(slAlert.direction, 'below');
  });

  // 3. Target 1 Breach Evaluation
  await test('Evaluate Tick: TP1 Trigger on Crossing Above', () => {
    const active = AlertEngine.getActiveAlerts();
    const tp1Alert = active.find(a => a.type === 'target_tp1');
    assert.strictEqual(tp1Alert.triggered, false);

    // Tick below TP1 (no trigger)
    AlertEngine.evaluateTick({ symbol: 'RELIANCE.NS', price: 3050.00 });
    assert.strictEqual(tp1Alert.triggered, false);

    // Tick at or above TP1 (should trigger!)
    AlertEngine.evaluateTick({ symbol: 'RELIANCE.NS', price: 3105.00 });
    assert.strictEqual(tp1Alert.triggered, true);

    const history = AlertEngine.getHistory();
    assert(history.length > 0, 'History should contain triggered event');
    assert.strictEqual(history[0].symbol, 'RELIANCE.NS');
    assert.strictEqual(history[0].levelType, 'tp');
  });

  // 4. Stop Loss Breach Evaluation
  await test('Evaluate Tick: Stop Loss Trigger on Crossing Below', () => {
    const active = AlertEngine.getActiveAlerts();
    const slAlert = active.find(a => a.type === 'target_sl');
    assert.strictEqual(slAlert.triggered, false);

    // Tick above SL (safe)
    AlertEngine.evaluateTick({ symbol: 'RELIANCE.NS', price: 2980.00 });
    assert.strictEqual(slAlert.triggered, false);

    // Tick below SL (breach!)
    AlertEngine.evaluateTick({ symbol: 'RELIANCE.NS', price: 2935.00 });
    assert.strictEqual(slAlert.triggered, true);

    const history = AlertEngine.getHistory();
    const slEvent = history.find(h => h.type === 'target_sl');
    assert(slEvent, 'SL event should be logged in history');
    assert.strictEqual(slEvent.levelType, 'sl');
  });

  // 5. High-Conviction Confluence (>80% Confidence) Detection
  await test('High-Conviction Setup Trigger (> 80% Confidence)', () => {
    // 1. Low confidence (< 80%) should not trigger
    const initialHistoryLength = AlertEngine.getHistory().length;
    AlertEngine.checkHighConvictionSetup('TCS.NS', {
      signal: 'BUY STOCK',
      confidence: 72,
      patterns: [{ name: 'Bullish Harami' }]
    }, 'Tata Consultancy Services');
    assert.strictEqual(AlertEngine.getHistory().length, initialHistoryLength, 'Should not trigger for 72% confidence');

    // 2. High confidence with HOLD should not trigger
    AlertEngine.checkHighConvictionSetup('TCS.NS', {
      signal: 'HOLD',
      confidence: 85,
    });
    assert.strictEqual(AlertEngine.getHistory().length, initialHistoryLength, 'Should not trigger for HOLD');

    // 3. High confidence (> 80%) with BUY should trigger
    AlertEngine.checkHighConvictionSetup('TCS.NS', {
      signal: 'BUY STOCK',
      confidence: 88,
      patterns: [{ name: 'Morning Star' }],
      currentPrice: 4150.00,
    }, 'Tata Consultancy Services');

    const newHistory = AlertEngine.getHistory();
    assert.strictEqual(newHistory.length, initialHistoryLength + 1, 'Should log high conviction alert');
    assert.strictEqual(newHistory[0].levelType, 'conviction');
    assert.strictEqual(newHistory[0].confidence, 88);
  });

  // 6. Custom Price Alert (Above & Below)
  await test('Custom Price Alerts (Above & Below)', () => {
    AlertEngine.addCustomAlert('INFY.NS', 1900.00, 'above', 'Breakout Threshold');
    const active = AlertEngine.getActiveAlerts();
    const custom = active.find(a => a.symbol === 'INFY.NS');
    assert(custom, 'Custom alert not found');
    assert.strictEqual(custom.price, 1900.00);

    // Tick below
    AlertEngine.evaluateTick({ symbol: 'INFY.NS', price: 1880.00 });
    assert.strictEqual(custom.triggered, false);

    // Tick above
    AlertEngine.evaluateTick({ symbol: 'INFY.NS', price: 1905.00 });
    assert.strictEqual(custom.triggered, true);
  });

  // ════════════════════════════════════════════════════════════
  // 7. Watchlist Trade Signal Notifications: BUY
  // ════════════════════════════════════════════════════════════
  await test('Watchlist Stock BUY Signal Generates Notification', () => {
    localStorage.setItem('kdelta_watchlist', JSON.stringify(['RELIANCE.NS', 'TCS.NS', 'INFY.NS']));
    AlertEngine.syncWatchlist();

    const initialHistoryLength = AlertEngine.getHistory().length;

    // Simulate BUY signal for RELIANCE.NS
    AlertEngine.processSignalUpdate('RELIANCE.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY STOCK',
      confidence: 88,
      tradeSetup: {
        currentPrice: 3020.50,
        action: 'STRONG BUY STOCK',
      },
    });

    const history = AlertEngine.getHistory();
    assert.strictEqual(history.length, initialHistoryLength + 1, 'BUY notification must be added to history');
    const latest = history[0];
    assert.strictEqual(latest.symbol, 'RELIANCE');
    assert.strictEqual(latest.levelType, 'buy');
    assert.strictEqual(latest.signalType, 'BUY');
    assert.strictEqual(latest.price, 3020.50);
    assert.strictEqual(latest.title, 'BUY Signal');
    assert(latest.timeFormatted.includes('IST'), 'Must include IST time');
  });

  // ════════════════════════════════════════════════════════════
  // 8. Watchlist Signal Duplicate Prevention (BUY → BUY → BUY)
  // ════════════════════════════════════════════════════════════
  await test('Watchlist Signal Duplicate Prevention (BUY → BUY → BUY does not repeat)', () => {
    const historyBefore = AlertEngine.getHistory().length;

    // Repeated identical BUY updates on subsequent data refreshes
    AlertEngine.processSignalUpdate('RELIANCE.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY STOCK',
      confidence: 88,
      tradeSetup: { currentPrice: 3021.00, action: 'STRONG BUY STOCK' },
    });
    AlertEngine.processSignalUpdate('RELIANCE.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY STOCK',
      confidence: 89,
      tradeSetup: { currentPrice: 3022.00, action: 'STRONG BUY STOCK' },
    });

    const historyAfter = AlertEngine.getHistory().length;
    assert.strictEqual(historyAfter, historyBefore, 'Unchanged BUY signal must not generate duplicate notifications');
  });

  // ════════════════════════════════════════════════════════════
  // 9. Watchlist Signal Transition: BUY → SELL
  // ════════════════════════════════════════════════════════════
  await test('Watchlist Signal Transition: BUY → SELL Generates SELL Notification', () => {
    const historyBefore = AlertEngine.getHistory().length;

    // RELIANCE hits target -> SELL signal
    AlertEngine.processSignalUpdate('RELIANCE.NS', {
      signal: 'SELL STOCK',
      action: 'EXIT: TARGET 1 REACHED',
      confidence: 94,
      tradeSetup: {
        currentPrice: 3120.00,
        exitReason: 'Target reached',
      },
    });

    const history = AlertEngine.getHistory();
    assert.strictEqual(history.length, historyBefore + 1, 'SELL notification must be generated on transition');
    const latest = history[0];
    assert.strictEqual(latest.symbol, 'RELIANCE');
    assert.strictEqual(latest.levelType, 'sell');
    assert.strictEqual(latest.signalType, 'SELL');
    assert.strictEqual(latest.price, 3120.00);
    assert.strictEqual(latest.reason, 'Target reached');
    assert.strictEqual(latest.title, 'SELL Signal');
  });

  // ════════════════════════════════════════════════════════════
  // 10. Watchlist Signal Transition: SELL → EXIT
  // ════════════════════════════════════════════════════════════
  await test('Watchlist Signal Transition: SELL → EXIT Generates EXIT Notification', () => {
    const historyBefore = AlertEngine.getHistory().length;

    // Position square-off or stop condition -> EXIT signal
    AlertEngine.processSignalUpdate('RELIANCE.NS', {
      signal: 'SELL STOCK',
      action: 'EXIT: STOP LOSS TRIGGERED',
      confidence: 95,
      tradeSetup: {
        currentPrice: 2950.00,
        exitReason: 'Stop loss reached',
      },
    });

    const history = AlertEngine.getHistory();
    assert.strictEqual(history.length, historyBefore + 1, 'EXIT notification must be generated on transition');
    const latest = history[0];
    assert.strictEqual(latest.symbol, 'RELIANCE');
    assert.strictEqual(latest.levelType, 'exit');
    assert.strictEqual(latest.signalType, 'EXIT');
    assert.strictEqual(latest.reason, 'Stop loss reached');
    assert.strictEqual(latest.title, 'EXIT Signal');
  });

  // ════════════════════════════════════════════════════════════
  // 11. Watchlist Source Synchronization: Add & Remove Stock
  // ════════════════════════════════════════════════════════════
  await test('Watchlist Synchronization: Add and Remove Stock Monitoring', () => {
    // 1. Stock NOT in watchlist does not generate notification
    const historyBefore = AlertEngine.getHistory().length;
    AlertEngine.processSignalUpdate('UNWATCHED_TICKER.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY',
      tradeSetup: { currentPrice: 500 },
    });
    assert.strictEqual(AlertEngine.getHistory().length, historyBefore, 'Unwatched stock must not trigger notification');

    // 2. Add stock to Watchlist -> becomes eligible
    localStorage.setItem('kdelta_watchlist', JSON.stringify(['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'UNWATCHED_TICKER.NS']));
    AlertEngine.syncWatchlist();

    AlertEngine.processSignalUpdate('UNWATCHED_TICKER.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY',
      tradeSetup: { currentPrice: 505 },
    });
    assert.strictEqual(AlertEngine.getHistory().length, historyBefore + 1, 'Newly added watchlist stock must trigger notification');

    // 3. Remove stock from Watchlist -> stops being monitored
    AlertEngine.unmonitorSymbol('UNWATCHED_TICKER.NS');
    localStorage.setItem('kdelta_watchlist', JSON.stringify(['RELIANCE.NS', 'TCS.NS', 'INFY.NS']));
    AlertEngine.syncWatchlist();

    const historyAfterRemove = AlertEngine.getHistory().length;
    AlertEngine.processSignalUpdate('UNWATCHED_TICKER.NS', {
      signal: 'SELL STOCK',
      action: 'SELL',
      tradeSetup: { currentPrice: 490 },
    });
    assert.strictEqual(AlertEngine.getHistory().length, historyAfterRemove, 'Removed stock must no longer trigger notifications');
  });

  // ════════════════════════════════════════════════════════════
  // 12. Automatic Sound: Stock Price Moves UP and DOWN
  // ════════════════════════════════════════════════════════════
  await test('Automatic Sound on Upward and Downward Price Movements', async () => {
    AlertEngine.resetMovementSoundCooldown();
    const soundsPlayed = [];
    const origPlay = AudioAlerts.play;
    AudioAlerts.play = (type) => soundsPlayed.push(type);

    localStorage.setItem('kdelta_watchlist', JSON.stringify(['RELIANCE.NS', 'TCS.NS', 'INFY.NS']));
    AlertEngine.syncWatchlist();

    // 1. Initial baseline price (no sound on first baseline load)
    AlertEngine.processPriceUpdate('TCS.NS', 4000.00);
    assert.strictEqual(soundsPlayed.length, 0, 'No sound on initial baseline price');

    // 2. Upward Movement: 4000 -> 4020
    AlertEngine.processPriceUpdate('TCS.NS', 4020.00, 4000.00);
    assert(soundsPlayed.includes('price-up'), 'Price increase must play upward sound');

    // 3. Downward Movement: 4020 -> 4005 (after small delay to bypass debounce)
    await new Promise(r => setTimeout(r, 1300));
    AlertEngine.processPriceUpdate('TCS.NS', 4005.00, 4020.00);
    assert(soundsPlayed.includes('price-down'), 'Price decrease must play downward sound');

    // 4. Repeated Identical Price: 4005 -> 4005 (No movement)
    const countBefore = soundsPlayed.length;
    AlertEngine.processPriceUpdate('TCS.NS', 4005.00, 4005.00);
    assert.strictEqual(soundsPlayed.length, countBefore, 'Unchanged price must not trigger sound');

    // 5. Unwatched Stock: no movement sound
    AlertEngine.processPriceUpdate('NON_WATCHLIST.NS', 200.00, 190.00);
    assert.strictEqual(soundsPlayed.length, countBefore, 'Unwatched stock movement must not play sound');

    // 6. Rings every time while price is going up or down (instant successive movements)
    const soundsCount = soundsPlayed.length;
    AlertEngine.processPriceUpdate('TCS.NS', 4010.00, 4005.00); // UP
    AlertEngine.processPriceUpdate('TCS.NS', 4008.00, 4010.00); // DOWN
    AlertEngine.processPriceUpdate('TCS.NS', 4015.00, 4008.00); // UP
    assert.strictEqual(soundsPlayed.length, soundsCount + 3, 'Must ring every time price moves up or down without delay');

    // Restore AudioAlerts.play
    AudioAlerts.play = origPlay;
  });

  // ════════════════════════════════════════════════════════════
  // 13. BUY and SELL Signals Always Provide Explicit Exit Plan
  // ════════════════════════════════════════════════════════════
  await test('BUY Signal Notification Always Contains Exit Target and Stop Loss', () => {
    localStorage.setItem('kdelta_watchlist', JSON.stringify(['INFY.NS', 'WIPRO.NS']));
    AlertEngine.syncWatchlist();

    AlertEngine.processSignalUpdate('INFY.NS', {
      signal: 'BUY STOCK',
      action: 'STRONG BUY STOCK',
      confidence: 90,
      tradeSetup: {
        entryPrice: 1800.00,
        currentPrice: 1800.00,
        target1: 1836.00,
        target2: 1863.00,
        stopLoss: 1773.00,
        target1Pct: '+2.0%',
        target2Pct: '+3.5%',
        stopLossPct: '-1.5%',
      },
    });

    const history = AlertEngine.getHistory();
    const buyAlert = history[0];
    assert.strictEqual(buyAlert.symbol, 'INFY');
    assert.strictEqual(buyAlert.signalType, 'BUY');
    assert(buyAlert.message.includes('EXIT TARGET'), `Notification message must specify EXIT TARGET, got: ${buyAlert.message}`);
    assert(buyAlert.message.includes('EXIT STOP LOSS'), `Notification message must specify EXIT STOP LOSS, got: ${buyAlert.message}`);
    assert(buyAlert.message.includes('1836'), 'Message must include target price 1836');
    assert(buyAlert.message.includes('1773'), 'Message must include stop loss price 1773');

    // Verify watchlist signal state retrieval
    const state = AlertEngine.getWatchlistSignalState('INFY.NS');
    assert(state, 'Watchlist state should exist for INFY.NS');
    assert.strictEqual(state.signal, 'BUY');
    assert.strictEqual(state.target1, 1836.00);
    assert.strictEqual(state.stopLoss, 1773.00);
  });

  await test('SELL Signal Notification Always Contains Cover Target and Stop Loss', () => {
    AlertEngine.processSignalUpdate('WIPRO.NS', {
      signal: 'SELL STOCK',
      action: 'STRONG SELL STOCK',
      confidence: 86,
      tradeSetup: {
        entryPrice: 500.00,
        currentPrice: 500.00,
        target1: 490.00,
        target2: 482.50,
        stopLoss: 507.50,
        target1Pct: '-2.0%',
        target2Pct: '-3.5%',
        stopLossPct: '+1.5%',
      },
    });

    const history = AlertEngine.getHistory();
    const sellAlert = history[0];
    assert.strictEqual(sellAlert.symbol, 'WIPRO');
    assert.strictEqual(sellAlert.signalType, 'SELL');
    assert(sellAlert.message.includes('EXIT COVER TARGET') || sellAlert.message.includes('EXIT TARGET'), `Message must include cover target, got: ${sellAlert.message}`);
    assert(sellAlert.message.includes('EXIT STOP LOSS'), `Message must include stop loss, got: ${sellAlert.message}`);
    assert(sellAlert.message.includes('490'), 'Message must include target 490');
    assert(sellAlert.message.includes('507.5'), 'Message must include stop loss 507.5');

    const state = AlertEngine.getWatchlistSignalState('WIPRO.NS');
    assert(state, 'Watchlist state should exist for WIPRO.NS');
    assert.strictEqual(state.signal, 'SELL');
    assert.strictEqual(state.target1, 490.00);
    assert.strictEqual(state.stopLoss, 507.50);
  });

  console.log(`\n----------------------------------------------------`);
  console.log(`Alert Engine Test Results: ${passed} passed, ${failed} failed`);
  console.log(`----------------------------------------------------`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAlertTests();


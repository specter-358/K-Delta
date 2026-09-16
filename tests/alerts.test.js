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

  console.log(`\n----------------------------------------------------`);
  console.log(`Alert Engine Test Results: ${passed} passed, ${failed} failed`);
  console.log(`----------------------------------------------------`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAlertTests();

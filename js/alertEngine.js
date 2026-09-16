/* ============================================================
   K-Delta — Real-Time Browser Audio & Price Alert Engine
   Monitors Target Breaches (Entry, TP1, TP2, Stop Loss),
   High-Conviction Setups (>80%), Custom Price Alerts,
   Web Audio Chimes & Desktop Web Push Notifications
   ============================================================ */

const AlertEngine = (() => {
  const STORAGE_KEY_ACTIVE = 'kdelta_active_alerts';
  const STORAGE_KEY_HISTORY = 'kdelta_alerts_history';
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 minute debounce per alert level

  let activeAlerts = [];
  let alertHistory = [];
  const cooldownMap = new Map();
  let unreadCount = 0;

  // Listeners for UI reactive updates
  const uiListeners = new Set();

  /**
   * Initialize Alert Engine
   */
  function init() {
    loadFromStorage();
    setupWebSocketWatcher();
    injectToastContainer();
    injectAlertsCenterModal();
    updateNavbarBadges();

    // Check notification permission state
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      console.log('[AlertEngine] Web Notifications active & permitted');
    }
  }

  function loadFromStorage() {
    try {
      const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (savedActive) activeAlerts = JSON.parse(savedActive);

      const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (savedHistory) alertHistory = JSON.parse(savedHistory);
    } catch (e) {
      console.warn('[AlertEngine] Storage load error:', e);
      activeAlerts = [];
      alertHistory = [];
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(activeAlerts));
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(alertHistory.slice(0, 60))); // Keep last 60
    } catch (e) {
      console.warn('[AlertEngine] Storage save error:', e);
    }
    notifyListeners();
  }

  function notifyListeners() {
    uiListeners.forEach(cb => {
      try { cb({ activeAlerts, alertHistory, unreadCount }); } catch (e) {}
    });
    updateNavbarBadges();
  }

  /**
   * Watch WebSocket Ticks globally
   */
  function setupWebSocketWatcher() {
    if (typeof API !== 'undefined' && API.onTick) {
      API.onTick(tick => {
        evaluateTick(tick);
      });
    }
  }

  /**
   * Evaluate a tick against active alerts
   */
  function evaluateTick(tick) {
    if (!tick || !tick.symbol || typeof tick.price !== 'number' || tick.price <= 0) return;

    const sym = tick.symbol.toUpperCase();
    const currentPrice = tick.price;
    const now = Date.now();

    activeAlerts.forEach(alert => {
      if (alert.symbol.toUpperCase() !== sym) return;
      if (alert.triggered) return;

      const cooldownKey = `${alert.id}_${alert.type}`;
      const lastFired = cooldownMap.get(cooldownKey) || 0;
      if (now - lastFired < COOLDOWN_MS) return;

      let hasTriggered = false;
      let triggerDetail = '';

      switch (alert.type) {
        case 'target_entry':
          // Price touches or falls inside entry zone
          if (alert.zoneMin && alert.zoneMax) {
            if (currentPrice >= alert.zoneMin && currentPrice <= alert.zoneMax) {
              hasTriggered = true;
              triggerDetail = `Entered Entry Zone (₹${alert.zoneMin.toFixed(2)} – ₹${alert.zoneMax.toFixed(2)})`;
            }
          } else if (alert.price) {
            const diffPct = Math.abs(currentPrice - alert.price) / alert.price;
            if (diffPct <= 0.003) { // Within 0.3%
              hasTriggered = true;
              triggerDetail = `Reached Entry Price ₹${alert.price.toFixed(2)}`;
            }
          }
          break;

        case 'target_tp1':
          if (alert.direction === 'below') {
            if (currentPrice <= alert.price) hasTriggered = true;
          } else {
            if (currentPrice >= alert.price) hasTriggered = true;
          }
          if (hasTriggered) {
            triggerDetail = `Hit Target 1 (TP1) at ₹${alert.price.toFixed(2)}`;
          }
          break;

        case 'target_tp2':
          if (alert.direction === 'below') {
            if (currentPrice <= alert.price) hasTriggered = true;
          } else {
            if (currentPrice >= alert.price) hasTriggered = true;
          }
          if (hasTriggered) {
            triggerDetail = `Hit Target 2 (TP2) at ₹${alert.price.toFixed(2)}`;
          }
          break;

        case 'target_sl':
          if (alert.direction === 'above') { // for short setup
            if (currentPrice >= alert.price) hasTriggered = true;
          } else { // for long setup
            if (currentPrice <= alert.price) hasTriggered = true;
          }
          if (hasTriggered) {
            triggerDetail = `Breached Stop Loss at ₹${alert.price.toFixed(2)}`;
          }
          break;

        case 'custom_above':
          if (currentPrice >= alert.price) {
            hasTriggered = true;
            triggerDetail = `Crossed Above ₹${alert.price.toFixed(2)}`;
          }
          break;

        case 'custom_below':
          if (currentPrice <= alert.price) {
            hasTriggered = true;
            triggerDetail = `Crossed Below ₹${alert.price.toFixed(2)}`;
          }
          break;
      }

      if (hasTriggered) {
        cooldownMap.set(cooldownKey, now);
        alert.triggered = true;
        alert.triggeredAt = now;

        dispatchAlertTriggered({
          id: alert.id,
          symbol: alert.symbol,
          company: alert.company || alert.symbol,
          type: alert.type,
          levelType: getLevelCategory(alert.type),
          price: currentPrice,
          targetPrice: alert.price,
          title: `${alert.symbol} — ${alert.label || triggerDetail}`,
          message: `${alert.company || alert.symbol} live price is ₹${currentPrice.toFixed(2)}. ${triggerDetail}.`,
          timestamp: now,
        });

        saveToStorage();
      }
    });
  }

  function getLevelCategory(type) {
    if (type.includes('tp')) return 'tp';
    if (type.includes('entry')) return 'entry';
    if (type.includes('sl') || type.includes('stop')) return 'sl';
    return 'custom';
  }

  /**
   * Trigger and broadcast an alert event
   */
  function dispatchAlertTriggered(alertEvent) {
    unreadCount++;

    // 1. Play Institutional Web Audio Chime
    if (typeof AudioAlerts !== 'undefined') {
      const soundMap = {
        tp: 'target-hit',
        entry: 'entry-trigger',
        sl: 'stop-hit',
        conviction: 'high-conviction',
        custom: 'entry-trigger',
      };
      AudioAlerts.play(soundMap[alertEvent.levelType] || 'entry-trigger');
    }

    // 2. Add to Historical Feed
    alertHistory.unshift({
      ...alertEvent,
      timeFormatted: formatAlertISTTime(alertEvent.timestamp),
    });
    if (alertHistory.length > 60) alertHistory.pop();

    // 3. Trigger Desktop Web Notification
    sendDesktopNotification(alertEvent);

    // 4. Trigger In-App Floating Toast
    showToast(alertEvent);

    // 5. Update Navbar Badges
    updateNavbarBadges();
    renderAlertsCenterContent();
  }

  /**
   * Check for High-Conviction Technical Setup (> 80% Confidence)
   */
  function checkHighConvictionSetup(symbol, prediction, companyName = '') {
    if (!prediction || prediction.confidence < 80) return;
    if (prediction.signal === 'HOLD') return;

    const now = Date.now();
    const cooldownKey = `conviction_${symbol}_${prediction.signal}`;
    const lastFired = cooldownMap.get(cooldownKey) || 0;
    if (now - lastFired < COOLDOWN_MS * 2) return; // 10m cooldown for setup alert

    cooldownMap.set(cooldownKey, now);

    const primaryPattern = (prediction.patterns && prediction.patterns[0]) ? prediction.patterns[0].name : 'Multi-Indicator Confluence';
    const title = `⚡ High Conviction (${prediction.confidence}%): ${symbol}`;
    const message = `Algorithmic ${prediction.signal} confirmed by ${primaryPattern}. Confidence score: ${prediction.confidence}%.`;

    dispatchAlertTriggered({
      id: `hc_${symbol}_${now}`,
      symbol,
      company: companyName || symbol,
      type: 'high_conviction',
      levelType: 'conviction',
      confidence: prediction.confidence,
      price: prediction.currentPrice || null,
      title,
      message,
      timestamp: now,
    });
  }

  /**
   * 1-Click Track Trade Setup Targets for currently viewed stock
   */
  function trackTradeSetup(symbol, setup, companyName = '') {
    if (!setup) return 0;

    const sym = symbol.toUpperCase();
    const isBull = !setup.action || !setup.action.toLowerCase().includes('sell');
    const direction = isBull ? 'above' : 'below';
    const oppositeDir = isBull ? 'below' : 'above';
    const now = Date.now();
    let addedCount = 0;

    // Remove old target alerts for this symbol to avoid clutter
    activeAlerts = activeAlerts.filter(a => !(a.symbol === sym && a.type.startsWith('target_')));

    // 1. Entry Zone Alert
    if (setup.entryMin && setup.entryMax) {
      activeAlerts.push({
        id: `alert_${sym}_entry_${now}`,
        symbol: sym,
        company: companyName || sym,
        type: 'target_entry',
        zoneMin: setup.entryMin,
        zoneMax: setup.entryMax,
        price: setup.entryPrice || setup.entryMin,
        direction: 'zone',
        label: `Entry Zone (₹${setup.entryMin.toFixed(2)} - ₹${setup.entryMax.toFixed(2)})`,
        createdAt: now,
        triggered: false,
      });
      addedCount++;
    } else if (setup.entryPrice) {
      activeAlerts.push({
        id: `alert_${sym}_entry_${now}`,
        symbol: sym,
        company: companyName || sym,
        type: 'target_entry',
        price: setup.entryPrice,
        direction: 'zone',
        label: `Entry Price (₹${setup.entryPrice.toFixed(2)})`,
        createdAt: now,
        triggered: false,
      });
      addedCount++;
    }

    // 2. TP1 Alert
    if (setup.target1) {
      activeAlerts.push({
        id: `alert_${sym}_tp1_${now}`,
        symbol: sym,
        company: companyName || sym,
        type: 'target_tp1',
        price: setup.target1,
        direction,
        label: `Target 1 (TP1) ₹${setup.target1.toFixed(2)}`,
        createdAt: now,
        triggered: false,
      });
      addedCount++;
    }

    // 3. TP2 Alert
    if (setup.target2) {
      activeAlerts.push({
        id: `alert_${sym}_tp2_${now}`,
        symbol: sym,
        company: companyName || sym,
        type: 'target_tp2',
        price: setup.target2,
        direction,
        label: `Target 2 (TP2) ₹${setup.target2.toFixed(2)}`,
        createdAt: now,
        triggered: false,
      });
      addedCount++;
    }

    // 4. Stop Loss Alert
    if (setup.stopLoss) {
      activeAlerts.push({
        id: `alert_${sym}_sl_${now}`,
        symbol: sym,
        company: companyName || sym,
        type: 'target_sl',
        price: setup.stopLoss,
        direction: oppositeDir,
        label: `Stop Loss ₹${setup.stopLoss.toFixed(2)}`,
        createdAt: now,
        triggered: false,
      });
      addedCount++;
    }

    saveToStorage();

    // Play quick chime acknowledgment
    if (typeof AudioAlerts !== 'undefined') {
      AudioAlerts.play('entry-trigger');
    }

    // Feedback Toast
    showToast({
      symbol: sym,
      levelType: 'entry',
      title: `🎯 Alerts Armed: ${sym}`,
      message: `Tracking ${addedCount} targets (Entry, TP1, TP2, Stop Loss). Audio & Web Push will trigger upon price breach.`,
      price: setup.entryPrice,
    });

    return addedCount;
  }

  /**
   * Add a custom price alert
   */
  function addCustomAlert(symbol, price, condition = 'above', note = '') {
    if (!symbol || !price || isNaN(price)) return false;

    const sym = symbol.toUpperCase().trim();
    const targetPrice = parseFloat(price);
    const now = Date.now();
    const type = condition === 'above' ? 'custom_above' : 'custom_below';
    const label = note ? `${note} (₹${targetPrice.toFixed(2)})` : `Crosses ${condition.toUpperCase()} ₹${targetPrice.toFixed(2)}`;

    activeAlerts.push({
      id: `custom_${sym}_${now}`,
      symbol: sym,
      company: sym,
      type,
      price: targetPrice,
      direction: condition,
      label,
      createdAt: now,
      triggered: false,
    });

    saveToStorage();

    showToast({
      symbol: sym,
      levelType: 'custom',
      title: `Custom Alert Set: ${sym}`,
      message: `You will be alerted when ${sym} crosses ${condition} ₹${targetPrice.toFixed(2)}.`,
      price: targetPrice,
    });

    return true;
  }

  /**
   * Remove an active alert
   */
  function removeAlert(alertId) {
    activeAlerts = activeAlerts.filter(a => a.id !== alertId);
    saveToStorage();
    renderAlertsCenterContent();
  }

  /**
   * Clear all alert history
   */
  function clearHistory() {
    alertHistory = [];
    unreadCount = 0;
    saveToStorage();
    renderAlertsCenterContent();
  }

  /**
   * Request Desktop Web Notification Permission
   */
  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      alert('HTML5 Web Notifications are not supported in your browser.');
      return 'unsupported';
    }

    try {
      const perm = await Notification.requestPermission();
      renderAlertsCenterContent();
      if (perm === 'granted') {
        showToast({
          symbol: 'K-DELTA',
          levelType: 'tp',
          title: 'Web Notifications Enabled!',
          message: 'Desktop alerts are active. You will receive alerts even when working in other tabs or apps.',
        });
      }
      return perm;
    } catch (err) {
      console.warn('Notification permission error:', err);
      return 'denied';
    }
  }

  /**
   * Send Desktop Web Notification
   */
  function sendDesktopNotification(event) {
    if (typeof Notification === 'undefined' || typeof Notification !== 'function' || Notification.permission !== 'granted') return;

    try {
      const n = new Notification(event.title, {
        body: event.message,
        icon: 'images/logo-icon.png',
        tag: `kdelta-${event.symbol}-${event.type}`,
        badge: 'images/logo-icon.png',
        requireInteraction: false,
      });

      n.onclick = () => {
        window.focus();
        if (event.symbol) {
          window.location.href = `dashboard.html?symbol=${encodeURIComponent(event.symbol)}`;
        }
        n.close();
      };
    } catch (e) {
      console.warn('[AlertEngine] Notification dispatch error:', e);
    }
  }

  /**
   * Floating Toast Notifications
   */
  function injectToastContainer() {
    if (document.getElementById('kdelta-toast-container')) return;
    const container = document.createElement('div');
    container.id = 'kdelta-toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  function showToast(event) {
    injectToastContainer();
    const container = document.getElementById('kdelta-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const badgeClass = `toast-badge--${event.levelType || 'entry'}`;
    const formattedPrice = event.price ? `₹${parseFloat(event.price).toFixed(2)}` : '';

    toast.className = `kdelta-toast toast--${event.levelType || 'entry'}`;
    toast.innerHTML = `
      <div class="toast-header">
        <div class="toast-title-wrap">
          <span class="toast-badge ${badgeClass}">${(event.levelType || 'ALERT').toUpperCase()}</span>
          <strong class="toast-symbol">${event.symbol || 'K-DELTA'}</strong>
          ${formattedPrice ? `<span class="toast-price">${formattedPrice}</span>` : ''}
        </div>
        <button class="toast-close-btn" title="Dismiss">&times;</button>
      </div>
      <div class="toast-body">${event.message || event.title}</div>
      <div class="toast-actions">
        ${event.symbol ? `<a href="dashboard.html?symbol=${encodeURIComponent(event.symbol)}" class="toast-action-link">Open Terminal →</a>` : ''}
        <span class="toast-time">${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} IST</span>
      </div>
      <div class="toast-progress"><div class="toast-progress-bar"></div></div>
    `;

    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => removeToast(toast);
    }

    container.appendChild(toast);

    // Auto dismiss after 6.5 seconds
    const timer = setTimeout(() => {
      removeToast(toast);
    }, 6500);

    toast.addEventListener('mouseenter', () => {
      const pBar = toast.querySelector('.toast-progress-bar');
      if (pBar) pBar.style.animationPlayState = 'paused';
      clearTimeout(timer);
    });
  }

  function removeToast(toast) {
    if (!toast) return;
    toast.classList.add('toast--exit');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }

  /**
   * Navbar Badges & Mute Button Update
   */
  function updateNavbarBadges() {
    const badgeEl = document.getElementById('navbar-alerts-badge');
    const bellBtn = document.getElementById('btn-navbar-alerts');
    const muteBtn = document.getElementById('btn-navbar-audio-toggle');

    if (badgeEl) {
      if (unreadCount > 0) {
        badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badgeEl.style.display = 'inline-flex';
        if (bellBtn) bellBtn.classList.add('has-unread');
      } else {
        badgeEl.style.display = 'none';
        if (bellBtn) bellBtn.classList.remove('has-unread');
      }
    }

    if (muteBtn && typeof AudioAlerts !== 'undefined') {
      const { isMuted } = AudioAlerts.getSettings();
      muteBtn.innerHTML = isMuted
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg><span class="audio-toggle-label">Muted</span>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><span class="audio-toggle-label">Audio ON</span>`;
      muteBtn.className = `navbar-audio-btn ${isMuted ? 'muted' : 'active'}`;
    }
  }

  /**
   * Alerts Center Modal Injection & Management
   */
  function injectAlertsCenterModal() {
    if (document.getElementById('kdelta-alerts-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'kdelta-alerts-modal';
    modal.className = 'alerts-modal-backdrop';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="alerts-modal-drawer" id="alerts-modal-drawer">
        <div class="alerts-drawer-header">
          <div class="alerts-drawer-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span>Live Alerts Center</span>
            <span class="active-pulse-dot"></span>
          </div>
          <button class="alerts-drawer-close" onclick="AlertEngine.closeAlertsCenter()">&times;</button>
        </div>

        <div class="alerts-drawer-body" id="alerts-drawer-content">
          <!-- Populated dynamically -->
        </div>
      </div>
    `;

    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) closeAlertsCenter();
    };

    document.body.appendChild(modal);
  }

  function openAlertsCenter() {
    injectAlertsCenterModal();
    const modal = document.getElementById('kdelta-alerts-modal');
    if (modal) {
      modal.style.display = 'flex';
      renderAlertsCenterContent();
      unreadCount = 0;
      updateNavbarBadges();
    }
  }

  function closeAlertsCenter() {
    const modal = document.getElementById('kdelta-alerts-modal');
    if (modal) modal.style.display = 'none';
  }

  function renderAlertsCenterContent() {
    const content = document.getElementById('alerts-drawer-content');
    if (!content) return;

    const audioSettings = typeof AudioAlerts !== 'undefined' ? AudioAlerts.getSettings() : { isMuted: false, volume: 0.7 };
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

    content.innerHTML = `
      <!-- Audio Settings Bar -->
      <div class="alerts-section">
        <div class="alerts-section-title">Institutional Audio Engine</div>
        <div class="alerts-audio-card">
          <div class="audio-ctrl-row">
            <label class="audio-switch-label">
              <input type="checkbox" id="modal-audio-mute-cb" ${!audioSettings.isMuted ? 'checked' : ''} onchange="AudioAlerts.setMuted(!this.checked)">
              <span>Audible Sound Chimes</span>
            </label>
            <div class="audio-vol-wrap">
              <span class="audio-vol-text">${Math.round(audioSettings.volume * 100)}%</span>
              <input type="range" min="0" max="1" step="0.05" value="${audioSettings.volume}" id="modal-audio-vol" oninput="AudioAlerts.setVolume(this.value); document.querySelector('.audio-vol-text').textContent = Math.round(this.value*100)+'%';">
            </div>
          </div>

          <div class="chime-test-buttons">
            <button class="btn-chime-test" onclick="AudioAlerts.testChime('target-hit')" title="Test TP1/TP2 Chime">
              <span>🎯 Target Hit (TP1)</span>
            </button>
            <button class="btn-chime-test" onclick="AudioAlerts.testChime('entry-trigger')" title="Test Entry Chime">
              <span>🔔 Entry Breach</span>
            </button>
            <button class="btn-chime-test" onclick="AudioAlerts.testChime('stop-hit')" title="Test Stop Loss Chime">
              <span>🛑 Stop Loss Warning</span>
            </button>
            <button class="btn-chime-test" onclick="AudioAlerts.testChime('high-conviction')" title="Test High Conviction Chime">
              <span>⚡ >80% Setup Pulse</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop Push Status -->
      <div class="alerts-section">
        <div class="alerts-section-title">Desktop Web Push Notifications</div>
        <div class="alerts-push-card ${perm === 'granted' ? 'active' : ''}">
          <div class="push-status-info">
            <span class="status-dot ${perm === 'granted' ? 'open' : ''}"></span>
            <span>Desktop Background Alerts: <strong>${perm.toUpperCase()}</strong></span>
          </div>
          ${perm !== 'granted' ? `
            <button class="btn btn--primary btn--sm" onclick="AlertEngine.requestNotificationPermission()">
              Enable Desktop Push
            </button>
          ` : `
            <span class="push-active-badge">✓ Active in Background</span>
          `}
        </div>
      </div>

      <!-- Quick Custom Alert Creator -->
      <div class="alerts-section">
        <div class="alerts-section-title">Set Custom Price Alert</div>
        <div class="custom-alert-form">
          <input type="text" id="custom-alert-sym" placeholder="Symbol (e.g. RELIANCE.NS)" class="alert-input">
          <select id="custom-alert-cond" class="alert-select">
            <option value="above">Crosses Above (≥)</option>
            <option value="below">Crosses Below (≤)</option>
          </select>
          <input type="number" id="custom-alert-price" placeholder="Target Price (₹)" step="0.05" class="alert-input">
          <button class="btn btn--primary btn--sm" onclick="AlertEngine.handleAddCustomFromModal()">Arm Alert</button>
        </div>
      </div>

      <!-- Active Monitored Targets -->
      <div class="alerts-section">
        <div class="alerts-section-title">
          <span>Active Monitored Targets (${activeAlerts.filter(a => !a.triggered).length})</span>
        </div>
        <div class="active-alerts-list">
          ${renderActiveAlertsList()}
        </div>
      </div>

      <!-- Triggered Alerts Log -->
      <div class="alerts-section">
        <div class="alerts-section-title">
          <span>Triggered Alerts Log (${alertHistory.length})</span>
          ${alertHistory.length > 0 ? '<button class="btn-text-action" onclick="AlertEngine.clearHistory()">Clear Log</button>' : ''}
        </div>
        <div class="history-alerts-list">
          ${renderHistoryList()}
        </div>
      </div>
    `;
  }

  function renderActiveAlertsList() {
    const unTriggered = activeAlerts.filter(a => !a.triggered);
    if (unTriggered.length === 0) {
      return `<div class="empty-alerts-state">No active target alerts armed. Click "Track Targets in Alerts" on any stock chart to begin live monitoring.</div>`;
    }

    return unTriggered.map(alert => `
      <div class="alert-row-card alert-row--${alert.levelType || 'entry'}">
        <div class="alert-row-left">
          <strong class="alert-row-symbol">${alert.symbol}</strong>
          <span class="alert-row-label">${alert.label || alert.type}</span>
        </div>
        <div class="alert-row-right">
          <span class="alert-row-target">₹${(alert.price || 0).toFixed(2)}</span>
          <button class="btn-remove-alert" onclick="AlertEngine.removeAlert('${alert.id}')" title="Delete Alert">&times;</button>
        </div>
      </div>
    `).join('');
  }

  function renderHistoryList() {
    if (alertHistory.length === 0) {
      return `<div class="empty-alerts-state">No alerts triggered yet during this session.</div>`;
    }

    return alertHistory.map(item => `
      <div class="alert-history-item history--${item.levelType || 'entry'}">
        <div class="history-item-top">
          <span class="history-badge history-badge--${item.levelType || 'entry'}">${(item.levelType || 'ALERT').toUpperCase()}</span>
          <strong class="history-symbol">${item.symbol}</strong>
          <span class="history-time">${item.timeFormatted || ''}</span>
        </div>
        <div class="history-message">${item.message || item.title}</div>
        <div class="history-actions">
          ${item.symbol ? `<a href="dashboard.html?symbol=${encodeURIComponent(item.symbol)}" class="history-link">View in Terminal →</a>` : ''}
        </div>
      </div>
    `).join('');
  }

  function handleAddCustomFromModal() {
    const symInput = document.getElementById('custom-alert-sym');
    const condSelect = document.getElementById('custom-alert-cond');
    const priceInput = document.getElementById('custom-alert-price');

    if (!symInput || !priceInput || !priceInput.value) {
      alert('Please enter a valid stock symbol and price threshold.');
      return;
    }

    const sym = symInput.value.trim().toUpperCase();
    const cond = condSelect ? condSelect.value : 'above';
    const price = parseFloat(priceInput.value);

    addCustomAlert(sym, price, cond);
    symInput.value = '';
    priceInput.value = '';
    renderAlertsCenterContent();
  }

  function formatAlertISTTime(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST';
  }

  // Auto initialize when DOM is ready
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return {
    init,
    evaluateTick,
    checkHighConvictionSetup,
    trackTradeSetup,
    addCustomAlert,
    removeAlert,
    clearHistory,
    requestNotificationPermission,
    openAlertsCenter,
    closeAlertsCenter,
    handleAddCustomFromModal,
    getActiveAlerts: () => activeAlerts,
    getHistory: () => alertHistory,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AlertEngine;
}

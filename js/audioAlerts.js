/* ============================================================
   K-Delta — Institutional Web Audio Alert Synthesizer
   Zero-Latency Algorithmic Sound Design via HTML5 Web Audio API
   ============================================================ */

const AudioAlerts = (() => {
  let audioCtx = null;
  let isMuted = false;
  let volume = 0.7; // 0.0 to 1.0

  // Load preferences from localStorage
  try {
    const savedMuted = localStorage.getItem('kdelta_audio_muted');
    if (savedMuted !== null) {
      isMuted = savedMuted === 'true';
    }
    const savedVol = localStorage.getItem('kdelta_audio_volume');
    if (savedVol !== null) {
      volume = Math.max(0, Math.min(1, parseFloat(savedVol)));
    }
  } catch (e) {
    console.warn('[AudioAlerts] LocalStorage unavailable for audio settings:', e);
  }

  /**
   * Safe AudioContext initialization & autoplay unlock
   */
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Unlock AudioContext on first user interaction anywhere on the page
  function setupAutoplayUnlock() {
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('pointerdown', unlock, { once: true });
  }

  if (typeof window !== 'undefined') {
    setupAutoplayUnlock();
  }

  /**
   * Synthesize an acoustic chime with given frequency and envelope
   */
  function playTone(ctx, freq, startTime, duration, masterGain, type = 'sine', decayFactor = 0.8) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    // Exponential decay envelope
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(1.0, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * decayFactor);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  /**
   * Sound Profile 1: Target Hit (TP1 / TP2)
   * Bright, optimistic ascending major triad arpeggio (C5 -> E5 -> G5 -> C6)
   */
  function synthesizeTargetHit(ctx, masterGain) {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      playTone(ctx, freq, start, 0.45, masterGain, 'sine', 0.85);
      // Subtle triangle overtone for metallic sparkle
      playTone(ctx, freq * 2, start, 0.25, masterGain, 'triangle', 0.4);
    });
  }

  /**
   * Sound Profile 2: Entry Zone Breach
   * Crisp, metallic dual-tone alert bell (D5 -> A5)
   */
  function synthesizeEntryTrigger(ctx, masterGain) {
    const now = ctx.currentTime;
    playTone(ctx, 587.33, now, 0.35, masterGain, 'sine', 0.7); // D5
    playTone(ctx, 880.00, now + 0.09, 0.50, masterGain, 'triangle', 0.85); // A5
    playTone(ctx, 1760.0, now + 0.09, 0.20, masterGain, 'sine', 0.3); // Upper harmonic
  }

  /**
   * Sound Profile 3: Stop Loss Hit
   * Soft, muted descending cautionary interval (A4 -> F4)
   */
  function synthesizeStopHit(ctx, masterGain) {
    const now = ctx.currentTime;
    // Low-pass filter for warmth/softness rather than harsh buzzer
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.connect(masterGain);

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440.0, now); // A4
    osc1.frequency.linearRampToValueAtTime(349.23, now + 0.25); // F4
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.linearRampToValueAtTime(0.8, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc1.connect(gain1);
    gain1.connect(filter);
    osc1.start(now);
    osc1.stop(now + 0.6);
  }

  /**
   * Sound Profile 4: High-Conviction Setup (> 80% Confidence)
   * Resonant electronic pulse chord (F5 + A5 + C6)
   */
  function synthesizeHighConviction(ctx, masterGain) {
    const now = ctx.currentTime;
    const chords = [
      [698.46, 880.00, 1046.50], // F Major triad
      [783.99, 987.77, 1174.66]  // G Major triad resolution
    ];

    chords.forEach((chord, cIdx) => {
      const cStart = now + cIdx * 0.14;
      chord.forEach(freq => {
        playTone(ctx, freq, cStart, 0.6, masterGain, 'sine', 0.75);
      });
    });
  }

  /**
   * Sound Profile 5: Upward Price Movement
   * Crisp, light, optimistic dual ascending micro-chimes (A5 -> D6)
   */
  function synthesizePriceUp(ctx, masterGain) {
    const now = ctx.currentTime;
    playTone(ctx, 880.00, now, 0.12, masterGain, 'sine', 0.75); // A5
    playTone(ctx, 1174.66, now + 0.06, 0.18, masterGain, 'sine', 0.85); // D6
  }

  /**
   * Sound Profile 6: Downward Price Movement
   * Soft, warm, cautionary dual descending micro-chimes (E5 -> B4)
   */
  function synthesizePriceDown(ctx, masterGain) {
    const now = ctx.currentTime;
    playTone(ctx, 659.25, now, 0.12, masterGain, 'sine', 0.75); // E5
    playTone(ctx, 493.88, now + 0.06, 0.18, masterGain, 'sine', 0.85); // B4
  }

  /**
   * Public: Play Chime by Alert Type
   * @param {'target-hit' | 'entry-trigger' | 'stop-hit' | 'high-conviction' | 'price-up' | 'price-down' | 'buy' | 'sell' | 'exit'} type
   * @param {boolean} force - Force play even if muted (used for sound preview buttons)
   */
  function play(type, force = false) {
    if (isMuted && !force) return;
    if (volume <= 0.001) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(volume * 0.65, ctx.currentTime);
      masterGain.connect(ctx.destination);

      switch (type) {
        case 'price-up':
        case 'price_up':
        case 'price-upward':
        case 'up':
          synthesizePriceUp(ctx, masterGain);
          break;
        case 'price-down':
        case 'price_down':
        case 'price-downward':
        case 'down':
          synthesizePriceDown(ctx, masterGain);
          break;
        case 'buy':
        case 'signal-buy':
        case 'entry-trigger':
        case 'entry':
          synthesizeEntryTrigger(ctx, masterGain);
          break;
        case 'sell':
        case 'signal-sell':
        case 'target-hit':
        case 'tp1':
        case 'tp2':
          synthesizeTargetHit(ctx, masterGain);
          break;
        case 'exit':
        case 'signal-exit':
        case 'stop-hit':
        case 'sl':
        case 'stop':
          synthesizeStopHit(ctx, masterGain);
          break;
        case 'high-conviction':
        case 'conviction':
          synthesizeHighConviction(ctx, masterGain);
          break;
        default:
          synthesizeEntryTrigger(ctx, masterGain);
          break;
      }
    } catch (err) {
      console.warn('[AudioAlerts] Playback error:', err);
    }
  }

  function syncNavbarButton(muted) {
    if (typeof document === 'undefined') return;
    const btns = [];
    const mainBtn = typeof document.getElementById === 'function' ? document.getElementById('btn-navbar-audio-toggle') : null;
    if (mainBtn) btns.push(mainBtn);

    if (typeof document.querySelectorAll === 'function') {
      try {
        const extraBtns = document.querySelectorAll('.navbar-audio-btn');
        extraBtns.forEach(b => {
          if (!btns.includes(b)) btns.push(b);
        });
      } catch (e) {}
    }

    btns.forEach(btn => {
      btn.className = `navbar-audio-btn ${muted ? 'muted' : 'active'}`;
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('title', muted ? 'Audio Muted — Click to Enable Audio Chimes' : 'Audio Active — Click to Mute');
      }
      btn.innerHTML = muted
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg><span class="audio-toggle-label">Muted</span>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><span class="audio-toggle-label">Audio ON</span>`;
    });

    const modalCb = typeof document.getElementById === 'function' ? document.getElementById('modal-audio-mute-cb') : null;
    if (modalCb) {
      modalCb.checked = !muted;
    }
  }

  function setMuted(val) {
    isMuted = !!val;
    try {
      localStorage.setItem('kdelta_audio_muted', String(isMuted));
    } catch (e) {}
    syncNavbarButton(isMuted);
    dispatchAudioStateChange();
    if (!isMuted) {
      play('setup_entry', true);
    }
    if (typeof showToast === 'function') {
      showToast(isMuted ? 'Alert audio chimes muted' : 'Alert audio chimes unmuted (Sound ON)', isMuted ? 'info' : 'success');
    }
    return isMuted;
  }

  function toggleMute() {
    return setMuted(!isMuted);
  }

  function setVolume(val) {
    volume = Math.max(0, Math.min(1, parseFloat(val) || 0));
    try {
      localStorage.setItem('kdelta_audio_volume', String(volume));
    } catch (e) {}
    dispatchAudioStateChange();
    return volume;
  }

  function getSettings() {
    return {
      isMuted,
      volume,
    };
  }

  const listeners = new Set();
  function onStateChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function dispatchAudioStateChange() {
    listeners.forEach(cb => {
      try { cb({ isMuted, volume }); } catch (e) {}
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => syncNavbarButton(isMuted));
    } else {
      syncNavbarButton(isMuted);
    }
  }

  return {
    play,
    testChime: (type) => play(type, true),
    setMuted,
    toggleMute,
    setVolume,
    getSettings,
    onStateChange,
    syncNavbarButton,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioAlerts;
}

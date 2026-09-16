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
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
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
   * Public: Play Chime by Alert Type
   * @param {'target-hit' | 'entry-trigger' | 'stop-hit' | 'high-conviction'} type
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
        case 'target-hit':
        case 'tp1':
        case 'tp2':
          synthesizeTargetHit(ctx, masterGain);
          break;
        case 'entry-trigger':
        case 'entry':
          synthesizeEntryTrigger(ctx, masterGain);
          break;
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

  function setMuted(val) {
    isMuted = !!val;
    try {
      localStorage.setItem('kdelta_audio_muted', String(isMuted));
    } catch (e) {}
    dispatchAudioStateChange();
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

  return {
    play,
    testChime: (type) => play(type, true),
    setMuted,
    toggleMute,
    setVolume,
    getSettings,
    onStateChange,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioAlerts;
}

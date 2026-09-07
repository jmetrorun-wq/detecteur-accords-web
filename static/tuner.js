/**
 * Accordeur guitare — accordage standard (Mi La Ré Sol Si Mi).
 *
 * Deux usages combinés :
 *  - toucher une mécanique joue le son de référence de la corde
 *    correspondante (accordage à l'oreille) ;
 *  - le micro détecte la hauteur jouée (fonction de différence normalisée
 *    cumulée, cœur de l'algo YIN — robuste aux harmoniques) et l'aiguille
 *    affiche l'écart en cents PAR RAPPORT à la corde active (verrouillée
 *    par un tap, sinon la plus proche automatiquement).
 */
function createTuner({ onUpdate, onError } = {}) {
  // Fréquences de l'accordage standard (La 4 = 440 Hz).
  const STRINGS = [
    { fr: 'Mi', octave: 2, hz: 82.41 },   // 6e corde (grave)
    { fr: 'La', octave: 2, hz: 110.00 },  // 5e
    { fr: 'Ré', octave: 3, hz: 146.83 },  // 4e
    { fr: 'Sol', octave: 3, hz: 196.00 }, // 3e
    { fr: 'Si', octave: 3, hz: 246.94 },  // 2e
    { fr: 'Mi', octave: 4, hz: 329.63 },  // 1re (aiguë)
  ];
  const FMIN = 55;
  const FMAX = 1600;
  const YIN_THRESHOLD = 0.12;

  let ac = null, analyser = null, source = null, stream = null;
  let rafId = null, buf = null;
  let smoothHz = 0, lastVoiceMs = 0;
  let manualIdx = null;   // corde verrouillée par un tap ; null = auto (plus proche)

  function detectPitch(x, sr) {
    const N = x.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return -1;

    const tauMax = Math.min(N >> 1, Math.ceil(sr / FMIN));
    const tauMin = Math.max(2, Math.floor(sr / FMAX));

    const d = new Float32Array(tauMax + 1);
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < N - tauMax; i++) {
        const diff = x[i] - x[i + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }

    const dn = new Float32Array(tauMax + 1);
    let running = 0;
    dn[0] = 1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      running += d[tau];
      dn[tau] = running > 0 ? d[tau] * (tau - tauMin + 1) / running : 1;
    }

    let tau = -1;
    for (let t = tauMin + 1; t < tauMax; t++) {
      if (dn[t] < YIN_THRESHOLD) {
        while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      let best = Infinity;
      for (let t = tauMin + 1; t < tauMax; t++) {
        if (dn[t] < best) { best = dn[t]; tau = t; }
      }
      if (tau === -1 || best > 0.5) return -1;
    }

    // Interpolation parabolique sur la différence BRUTE d[] (la version
    // normalisée dn[] biaise la période interpolée).
    let T = tau;
    if (tau > tauMin && tau < tauMax) {
      const y1 = d[tau - 1], y2 = d[tau], y3 = d[tau + 1];
      const denom = 2 * (2 * y2 - y1 - y3);
      if (denom !== 0) {
        const shift = (y3 - y1) / denom;
        if (shift > -1 && shift < 1) T = tau + shift;
      }
    }

    const f = sr / T;
    return (f >= FMIN && f <= FMAX) ? f : -1;
  }

  function nearestString(hz) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < STRINGS.length; i++) {
      const dist = Math.abs(1200 * Math.log2(hz / STRINGS[i].hz));
      if (dist < bd) { bd = dist; best = i; }
    }
    return best;
  }

  function emit(idx, hz) {
    const s = STRINGS[idx];
    const rawCents = hz > 0 ? 1200 * Math.log2(hz / s.hz) : null;
    onUpdate && onUpdate({
      stringIdx: idx,
      noteFr: s.fr,
      octave: s.octave,
      targetHz: s.hz,
      frequency: hz > 0 ? hz : 0,
      hasPitch: hz > 0,
      cents: rawCents == null ? 0 : Math.max(-50, Math.min(50, Math.round(rawCents))),
      inTune: rawCents != null && Math.abs(rawCents) <= 5,
    });
  }

  function loop() {
    analyser.getFloatTimeDomainData(buf);
    const f = detectPitch(buf, ac.sampleRate);
    const now = performance.now();

    if (f > 0) {
      smoothHz = smoothHz ? smoothHz * 0.8 + f * 0.2 : f;
      lastVoiceMs = now;
      emit(manualIdx != null ? manualIdx : nearestString(smoothHz), smoothHz);
    } else if (now - lastVoiceMs > 250) {
      smoothHz = 0;
      emit(manualIdx != null ? manualIdx : 0, 0);
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    async start() {
      if (ac) return;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { onError && onError(new Error('Web Audio indisponible')); return; }
      ac = new Ctor();
      if (ac.state === 'suspended') { try { await ac.resume(); } catch {} }
      // Le micro peut échouer (refus) sans empêcher les tons de référence.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (err) {
        onError && onError(err);
        return;
      }
      analyser = ac.createAnalyser();
      analyser.fftSize = 4096;
      buf = new Float32Array(analyser.fftSize);
      source = ac.createMediaStreamSource(stream);
      source.connect(analyser);
      smoothHz = 0;
      lastVoiceMs = performance.now();
      loop();
    },
    stop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (source) { try { source.disconnect(); } catch {} source = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (ac) { try { ac.close(); } catch {} ac = null; }
      analyser = null; buf = null; smoothHz = 0; manualIdx = null;
    },
    // Joue ~1,8 s le son de la corde `idx` (fondamentale + 2 harmoniques)
    // et verrouille l'aiguille sur cette corde.
    playString(idx) {
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      manualIdx = idx;
      const s = STRINGS[idx];
      const t0 = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.4, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      g.connect(ac.destination);
      [[1, 0.6], [2, 0.14], [3, 0.05]].forEach(([mult, amp]) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = s.hz * mult;
        const og = ac.createGain();
        og.gain.value = amp;
        o.connect(og).connect(g);
        o.start(t0);
        o.stop(t0 + 1.9);
      });
      emit(idx, smoothHz || 0);
    },
    // Verrouille (idx) ou repasse en auto (null).
    setTarget(idx) {
      manualIdx = idx;
      const active = idx != null ? idx : (smoothHz ? nearestString(smoothHz) : 0);
      emit(active, smoothHz || 0);
    },
    get manualIdx() { return manualIdx; },
    get running() { return !!ac; },
    get strings() { return STRINGS.slice(); },
  };
}

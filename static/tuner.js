/**
 * Accordeur guitare — accordage standard (Mi La Ré Sol Si Mi).
 *
 * Deux usages combinés :
 *  - toucher une mécanique joue le son de référence de la corde
 *    correspondante (accordage à l'oreille) ;
 *  - le micro détecte la hauteur jouée (méthode McLeod / NSDF — plus
 *    robuste qu'un simple YIN quand la corde s'éteint, car normalisée par
 *    l'énergie locale) et l'aiguille affiche l'écart en cents PAR RAPPORT
 *    à la corde active (verrouillée par un tap, sinon la plus proche
 *    automatiquement).
 *
 * Le signal du micro est passé-haut (~70 Hz, coupe le ronflement et la
 * manipulation) puis sous-échantillonné /2 avant l'analyse : la plage
 * utile (82–330 Hz) tient dans une fenêtre 4× moins lourde à traiter, ce
 * qui garde l'aiguille fluide même sur un téléphone. La recherche est
 * bornée juste autour des six cordes (70–400 Hz) : hors de cette bande,
 * la détection accrochait une harmonique et affichait la mauvaise octave.
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
  const FMIN = 70;               // un cran sous le Mi grave (82,41 Hz)
  const FMAX = 400;              // un cran au-dessus du Mi aigu (329,63 Hz)
  const NSDF_PICK = 0.9;         // 1er pic ≥ 0,9 × pic max (anti-erreur d'octave)
  const NSDF_MIN = 0.55;         // en deçà : signal pas assez périodique
  const RMS_GATE = 0.004;        // sous ce niveau : silence
  const DECIM = 2;               // sous-échantillonnage avant analyse
  const HPF_HZ = 70;             // passe-haut anti-ronflement

  let ac = null, analyser = null, source = null, makeup = null, stream = null;
  let rafId = null, buf = null;
  let smoothHz = 0, lastVoiceMs = 0, prevF = 0, lockCount = 0;
  let hpY = 0, hpX = 0;          // état du passe-haut (continu entre trames)
  let manualIdx = null;          // corde verrouillée par un tap ; null = auto
  let inTuneSinceMs = 0, confirmed = false; // « clic » de validation (front montant)
  let audioUnlocked = false;    // iOS : contexte débloqué par un geste

  // Prépare/débloque la sortie audio. À appeler depuis un geste (tap) : crée
  // le contexte si besoin, le réveille, et joue un échantillon muet — sinon
  // iOS garde le contexte muet en PWA installée.
  // Catégorie 'play-and-record' : compatible micro + sortie audible (la
  // catégorie 'playback' bloquerait getUserMedia).
  function ensureAudio() {
    if (!ac) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      ac = new Ctor();
    }
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
    if (ac.state === 'suspended') { try { ac.resume(); } catch {} }
    if (!audioUnlocked) {
      try {
        const src = ac.createBufferSource();
        src.buffer = ac.createBuffer(1, 1, 22050);
        src.connect(ac.destination);
        src.start(0);
        audioUnlocked = true;
      } catch {}
    }
    return true;
  }

  // Passe-haut 1 pôle puis décimation /DECIM (moyenne de DECIM échantillons,
  // anti-repliement léger). Rend un buffer DECIM× plus court.
  function preprocess(x, srIn) {
    const rc = 1 / (2 * Math.PI * HPF_HZ);
    const dt = 1 / srIn;
    const a = rc / (rc + dt);
    const n = x.length;
    const m = Math.floor(n / DECIM);
    const out = new Float32Array(m);
    let y = hpY, xp = hpX;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = 0; k < DECIM; k++) {
        const xi = x[i * DECIM + k];
        y = a * (y + xi - xp);
        xp = xi;
        s += y;
      }
      out[i] = s / DECIM;
    }
    hpY = y; hpX = xp;
    return out;
  }

  function detectPitch(x, sr) {
    const N = x.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / N);
    if (rms < RMS_GATE) return -1;

    const tauMax = Math.min(N >> 1, Math.ceil(sr / FMIN));
    const tauMin = Math.max(2, Math.floor(sr / FMAX));
    if (tauMax <= tauMin + 2) return -1;
    const W = N - tauMax;               // fenêtre d'intégration

    // NSDF (McLeod) : n(τ) = 2·Σ x[i]·x[i+τ] / Σ (x[i]² + x[i+τ]²).
    // Normalisée par l'énergie locale → ≈1 à la vraie période même quand
    // l'amplitude décroît fortement (corde qui s'éteint), là où un YIN
    // brut sous-estime la période.
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += x[i] * x[i];
    const nsdf = new Float32Array(tauMax + 1);
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let r = 0, et = 0;
      for (let i = 0; i < W; i++) {
        const a = x[i], b = x[i + tau];
        r += a * b;
        et += b * b;
      }
      const m = e0 + et;
      nsdf[tau] = m > 0 ? (2 * r) / m : 0;
    }

    // Maxima locaux positifs ; on garde le plus grand (maxVal), puis on
    // choisit le PREMIER pic ≥ NSDF_PICK × maxVal : c'est la vraie
    // fondamentale, pas une harmonique (erreur d'octave par le haut) ni
    // une sous-harmonique (erreur par le bas).
    let maxVal = 0, chosen = -1;
    const peaks = [];
    for (let t = tauMin + 1; t < tauMax; t++) {
      if (nsdf[t] > 0 && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) {
        peaks.push(t);
        if (nsdf[t] > maxVal) maxVal = nsdf[t];
        t++; // évite un doublon sur un plateau
      }
    }
    if (maxVal < NSDF_MIN) return -1;
    for (let i = 0; i < peaks.length; i++) {
      if (nsdf[peaks[i]] >= NSDF_PICK * maxVal) { chosen = peaks[i]; break; }
    }
    if (chosen < 0) return -1;

    // Interpolation parabolique autour du maximum retenu.
    let T = chosen;
    if (chosen > tauMin && chosen < tauMax) {
      const y1 = nsdf[chosen - 1], y2 = nsdf[chosen], y3 = nsdf[chosen + 1];
      const denom = y1 - 2 * y2 + y3;
      if (denom !== 0) {
        const shift = 0.5 * (y1 - y3) / denom;
        if (shift > -1 && shift < 1) T = chosen + shift;
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

  // Petit « clic » de validation : deux bips courts et aigus (bien au-dessus
  // de FMAX, donc sans effet sur la détection même repris par le micro).
  function playConfirm() {
    if (!ac) return;
    const t0 = ac.currentTime;
    [[0, 1320], [0.085, 1980]].forEach(([dt, hz]) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.13);
      o.connect(g).connect(ac.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.16);
    });
  }

  function loop() {
    analyser.getFloatTimeDomainData(buf);
    const ds = preprocess(buf, ac.sampleRate);
    const f = detectPitch(ds, ac.sampleRate / DECIM);
    const now = performance.now();

    if (f > 0) {
      // Deux trames cohérentes (±4 %) avant d'accrocher depuis le silence :
      // évite les sursauts parasites quand rien n'est joué.
      const consistent = prevF > 0 && Math.abs(f - prevF) / prevF < 0.04;
      prevF = f;
      if (smoothHz === 0) {
        if (consistent && ++lockCount >= 2) { smoothHz = f; lockCount = 0; }
        else { rafId = requestAnimationFrame(loop); return; }
      } else if (Math.abs(f - smoothHz) / smoothHz > 0.06) {
        smoothHz = f;                       // saut franc (changement de corde)
      } else {
        smoothHz = smoothHz * 0.6 + f * 0.4;
      }
      lastVoiceMs = now;
      const idx = manualIdx != null ? manualIdx : nearestString(smoothHz);
      // « Clic » de validation : joué une fois quand la corde reste juste
      // (±5 cents) au moins 150 ms. Réarmé seulement après un écart franc
      // (>12 cents) ou la perte du son.
      const cents = 1200 * Math.log2(smoothHz / STRINGS[idx].hz);
      if (Math.abs(cents) <= 5) {
        if (inTuneSinceMs === 0) inTuneSinceMs = now;
        if (!confirmed && now - inTuneSinceMs >= 150) { playConfirm(); confirmed = true; }
      } else if (Math.abs(cents) > 12) {
        inTuneSinceMs = 0; confirmed = false;
      }
      emit(idx, smoothHz);
    } else {
      prevF = 0; lockCount = 0;
      inTuneSinceMs = 0; confirmed = false;
      if (now - lastVoiceMs > 250) {
        smoothHz = 0;
        emit(manualIdx != null ? manualIdx : 0, 0);
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    async start() {
      if (analyser) return;              // micro déjà en écoute
      if (!ensureAudio()) { onError && onError(new Error('Web Audio indisponible')); return; }
      try { await ac.resume(); } catch {}
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
      analyser.smoothingTimeConstant = 0;
      buf = new Float32Array(analyser.fftSize);
      source = ac.createMediaStreamSource(stream);
      // Gain de rattrapage : sur certains téléphones, micro + AGC coupé donne
      // un niveau très faible ; la NSDF est insensible à l'échelle mais pas
      // la porte de silence. (Non connecté à la sortie : pas de larsen.)
      makeup = ac.createGain();
      makeup.gain.value = 4;
      source.connect(makeup);
      makeup.connect(analyser);
      smoothHz = 0; prevF = 0; lockCount = 0; hpY = 0; hpX = 0;
      inTuneSinceMs = 0; confirmed = false;
      lastVoiceMs = performance.now();
      loop();
    },
    stop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (source) { try { source.disconnect(); } catch {} source = null; }
      if (makeup) { try { makeup.disconnect(); } catch {} makeup = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (ac) { try { ac.close(); } catch {} ac = null; }
      analyser = null; buf = null; smoothHz = 0; prevF = 0; lockCount = 0;
      inTuneSinceMs = 0; confirmed = false; audioUnlocked = false;
      manualIdx = null;
    },
    // Joue ~1,8 s le son de la corde `idx` (fondamentale + 2 harmoniques)
    // et verrouille l'aiguille sur cette corde.
    playString(idx) {
      if (!ensureAudio()) return;
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
    // Crochets de test (algo pur, sans micro).
    _detectPitch: detectPitch,
    _preprocess: preprocess,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createTuner };

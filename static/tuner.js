/**
 * Accordeur chromatique — détecte la hauteur d'une note jouée seule via
 * le micro (autocorrélation sur le signal temporel), la ramène à la note
 * tempérée la plus proche (La 4 = 440 Hz) et donne l'écart en cents.
 *
 * Distinct de la détection d'accords (chroma multi-notes) : ici on veut
 * une fondamentale unique, précise, rafraîchie ~60×/s.
 */
function createTuner({ onUpdate, onError } = {}) {
  const A4 = 440;
  const NOTES_EN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const NOTES_FR = ['Do','Do♯','Ré','Ré♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'];
  const FMIN = 55;    // La 1 — sous une corde de basse
  const FMAX = 1600;  // au-dessus de la case 12 d'un aigu de guitare

  let ac = null, analyser = null, source = null, stream = null;
  let rafId = null, buf = null;
  let smoothHz = 0;        // lissage exponentiel de la fréquence
  let lastVoiceMs = 0;

  // Détection de hauteur par la fonction de différence normalisée
  // cumulée (cœur de l'algo YIN) : bien plus robuste aux harmoniques
  // qu'une simple autocorrélation — important pour un accordeur (un
  // instrument réel est riche en harmoniques). Renvoie la fréquence en
  // Hz, ou -1 si le signal est trop faible / non périodique.
  const YIN_THRESHOLD = 0.12;

  function detectPitch(x, sr) {
    const N = x.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return -1;   // trop silencieux

    const tauMax = Math.min(N >> 1, Math.ceil(sr / FMIN));
    const tauMin = Math.max(2, Math.floor(sr / FMAX));

    // d(tau) = somme des carrés des différences décalées de tau
    const d = new Float32Array(tauMax + 1);
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < N - tauMax; i++) {
        const diff = x[i] - x[i + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }

    // Normalisation cumulée : d'(tau) = d(tau) * tau / somme(d[1..tau])
    const dn = new Float32Array(tauMax + 1);
    let running = 0;
    dn[0] = 1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      running += d[tau];
      dn[tau] = running > 0 ? d[tau] * (tau - tauMin + 1) / running : 1;
    }

    // 1er tau sous le seuil, en le laissant descendre jusqu'à son minimum local.
    let tau = -1;
    for (let t = tauMin + 1; t < tauMax; t++) {
      if (dn[t] < YIN_THRESHOLD) {
        while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++;
        tau = t;
        break;
      }
    }
    // Repli : minimum global si rien ne passe le seuil.
    if (tau === -1) {
      let best = Infinity;
      for (let t = tauMin + 1; t < tauMax; t++) {
        if (dn[t] < best) { best = dn[t]; tau = t; }
      }
      if (tau === -1 || best > 0.5) return -1;
    }

    // Interpolation parabolique autour du minimum, sur la fonction de
    // différence BRUTE d[] (pas la version normalisée cumulée dn[], dont
    // la forme locale est biaisée par le terme cumulatif → décalage
    // systématique de la période interpolée).
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

  function loop() {
    analyser.getFloatTimeDomainData(buf);
    const f = detectPitch(buf, ac.sampleRate);
    const now = performance.now();

    if (f > 0) {
      smoothHz = smoothHz ? smoothHz * 0.8 + f * 0.2 : f;
      lastVoiceMs = now;
      const midi = 69 + 12 * Math.log2(smoothHz / A4);
      const nearest = Math.round(midi);
      const cents = Math.round((midi - nearest) * 100);
      const pc = ((nearest % 12) + 12) % 12;
      const target = A4 * Math.pow(2, (nearest - 69) / 12);
      onUpdate && onUpdate({
        note: NOTES_EN[pc],
        noteFr: NOTES_FR[pc],
        octave: Math.floor(nearest / 12) - 1,
        cents: Math.max(-50, Math.min(50, cents)),
        frequency: smoothHz,
        targetHz: target,
        inTune: Math.abs(cents) <= 5,
      });
    } else if (now - lastVoiceMs > 250) {
      smoothHz = 0;
      onUpdate && onUpdate(null);
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    async start() {
      if (ac) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (err) {
        onError && onError(err);
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      ac = new Ctor();
      if (ac.state === 'suspended') await ac.resume();
      analyser = ac.createAnalyser();
      analyser.fftSize = 4096;   // ~85 ms à 48 kHz : assez pour les cordes graves
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
      analyser = null; buf = null; smoothHz = 0;
    },
    get running() { return !!ac; },
  };
}

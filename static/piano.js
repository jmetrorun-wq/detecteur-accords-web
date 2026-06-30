/**
 * Piano 88 touches — rendu Canvas.
 * MG (orange) : fondamentale en octave 2.
 * MD (bleu) : accord complet en octave 4.
 */

const PIANO_NOTES    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PIANO_WHITE_SET = new Set([0, 2, 4, 5, 7, 9, 11]);

// Pré-calcul de la disposition des 88 touches (MIDI 21..108)
const PIANO_LAYOUT = (() => {
  const layout = [];
  let whiteCol = 0;
  for (let midi = 21; midi <= 108; midi++) {
    const nc = midi % 12;
    const isWhite = PIANO_WHITE_SET.has(nc);
    layout.push({ midi, nc, isWhite, col: isWhite ? whiteCol : whiteCol - 0.5 });
    if (isWhite) whiteCol++;
  }
  return layout;
})();

const PIANO_NUM_WHITE = 52;

// Intervalles par qualité d'accord (même mapping que chord_detector.py)
const PIANO_INTERVALS = {
  '':     [0, 4, 7],
  'm':    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'm7':   [0, 3, 7, 10],
  'maj7': [0, 4, 7, 11],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim':  [0, 3, 6],
  'aug':  [0, 4, 8],
  'add9': [0, 4, 7, 2],
};

function pianoChordTones(chord) {
  if (!chord || chord === 'N') return null;
  for (let i = 0; i < PIANO_NOTES.length; i++) {
    const note = PIANO_NOTES[i];
    if (!chord.startsWith(note)) continue;
    const rest = chord.slice(note.length);
    if (rest.length > 0 && rest[0] === '#' && note.length === 1) continue;
    const quality = rest;
    const ivs = PIANO_INTERVALS[quality] ?? [0, 4, 7];
    return { rootNc: i, intervals: ivs };
  }
  return null;
}

function drawPiano(canvas, chord) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight;

  // Resize canvas si besoin
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Fond
  ctx.fillStyle = '#0C0C18';
  ctx.fillRect(0, 0, W, H);

  const kw  = W / PIANO_NUM_WHITE;        // largeur touche blanche
  const bkw = Math.max(3, kw * 0.56);    // largeur touche noire
  const bkh = H * 0.60;                  // hauteur touche noire

  // ── Calcul des MIDI actifs ──────────────────────────────────────
  let lhMidis   = new Set();
  let rhMidis   = new Set();
  let rhRootMidi = -1;

  const tones = pianoChordTones(chord);
  if (tones) {
    const { rootNc, intervals } = tones;
    lhMidis.add(36 + rootNc);            // fondamentale octave 2
    rhRootMidi = 60 + rootNc;             // fondamentale MD octave 4
    for (const iv of intervals) {
      rhMidis.add(60 + rootNc + iv);     // accord octave 4+
    }
  }

  function keyFill(midi, isWhite) {
    if (lhMidis.has(midi))   return '#FF9100';
    if (midi === rhRootMidi)  return '#1A56DB';
    if (rhMidis.has(midi))   return '#4FC3F7';
    return isWhite ? '#CECEDD' : '#111120';
  }

  // ── Touches blanches ──────────────────────────────────────────
  for (const key of PIANO_LAYOUT) {
    if (!key.isWhite) continue;
    const x = key.col * kw;
    ctx.fillStyle = keyFill(key.midi, true);
    ctx.fillRect(x, 0, Math.max(1, kw - 1), H);
  }

  // ── Touches noires (par-dessus) ───────────────────────────────
  for (const key of PIANO_LAYOUT) {
    if (key.isWhite) continue;
    const x = key.col * kw - bkw / 2;
    ctx.fillStyle = keyFill(key.midi, false);
    ctx.fillRect(x, 0, bkw, bkh);
  }

  // ── Séparateur C4 (Do central, MIDI 60) ───────────────────────
  const c4 = PIANO_LAYOUT.find(k => k.midi === 60);
  if (c4) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#44445A';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(c4.col * kw, 0);
    ctx.lineTo(c4.col * kw, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Labels d'octave sous chaque Do ────────────────────────────
  const labelSize = Math.max(7, Math.min(kw * 0.65, 10));
  ctx.font = `${labelSize}px -apple-system, sans-serif`;
  ctx.textBaseline = 'bottom';
  for (const key of PIANO_LAYOUT) {
    if (key.nc !== 0) continue;
    const octave  = Math.floor(key.midi / 12) - 1;
    const isActive = lhMidis.has(key.midi) || rhMidis.has(key.midi) || key.midi === rhRootMidi;
    ctx.fillStyle = isActive ? '#BBBBCC' : '#44445A';
    ctx.fillText(`C${octave}`, key.col * kw + 1, H);
  }

  ctx.restore();
}

/**
 * Piano — une octave zoomée (Do4 à Do5) plutôt que le clavier 88 touches
 * complet : les notes de l'accord joué ressortent en couleur, avec leur
 * nom (fondamentale en bleu foncé, autres notes en bleu clair).
 */

const PIANO_NOTES     = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PIANO_WHITE_SET = new Set([0, 2, 4, 5, 7, 9, 11]);

// Disposition d'une octave complète (MIDI 60..72 = Do4 à Do5) — Do4 et
// Do5 sont tous deux des touches blanches, donc jamais de touche noire
// à moitié hors cadre en bord de clavier.
const PIANO_LAYOUT = (() => {
  const layout = [];
  let whiteCol = 0;
  for (let midi = 60; midi <= 72; midi++) {
    const nc = midi % 12;
    const isWhite = PIANO_WHITE_SET.has(nc);
    layout.push({ nc, isWhite, col: isWhite ? whiteCol : whiteCol - 0.5 });
    if (isWhite) whiteCol++;
  }
  return layout;
})();
const PIANO_NUM_WHITE = 8; // Do à Do

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

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#0C0C18';
  ctx.fillRect(0, 0, W, H);

  const tones = pianoChordTones(chord);
  const rootNc = tones ? tones.rootNc : -1;
  const activeNcs = new Set();
  if (tones) {
    activeNcs.add(tones.rootNc);
    for (const iv of tones.intervals) activeNcs.add((tones.rootNc + iv) % 12);
  }

  const kw  = W / PIANO_NUM_WHITE;
  const bkw = Math.max(4, kw * 0.58);
  const bkh = H * 0.60;

  function keyFill(nc, isWhite) {
    if (nc === rootNc)     return '#1A56DB';
    if (activeNcs.has(nc)) return '#4FC3F7';
    return isWhite ? '#CECEDD' : '#111120';
  }

  // ── Touches blanches ──────────────────────────────────────────
  for (const key of PIANO_LAYOUT) {
    if (!key.isWhite) continue;
    const x = key.col * kw;
    ctx.fillStyle = keyFill(key.nc, true);
    ctx.fillRect(x, 0, Math.max(1, kw - 1), H);
  }

  // ── Touches noires (par-dessus) ───────────────────────────────
  for (const key of PIANO_LAYOUT) {
    if (key.isWhite) continue;
    const x = key.col * kw - bkw / 2;
    ctx.fillStyle = keyFill(key.nc, false);
    ctx.fillRect(x, 0, bkw, bkh);
  }

  // ── Nom de note sur chaque touche active ──────────────────────
  if (tones) {
    const labelSize = Math.max(9, Math.min(kw * 0.42, 14));
    ctx.font = `700 ${labelSize}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    const seenNc = new Set();
    for (const key of PIANO_LAYOUT) {
      if (!activeNcs.has(key.nc) || seenNc.has(key.nc)) continue;
      seenNc.add(key.nc);
      const label = PIANO_NOTES[key.nc];
      const x = key.isWhite ? key.col * kw + kw / 2 : key.col * kw;
      const y = key.isWhite ? H - 6 : bkh - 6;
      ctx.fillText(label, x, y);
    }
  }

  ctx.restore();
}
